import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

/**
 * SSRF-resistant fetch. The agent can be asked to upload a file "from a URL",
 * which would otherwise let a chat user point the server at internal services
 * or the cloud metadata endpoint. This module restricts outbound requests to
 * http(s) and to publicly routable addresses, validating every redirect hop.
 * The connection itself is pinned to the addresses validated for that hop, so
 * DNS cannot change between validation and connect (rebinding).
 */

/** Resolves a hostname to its IP addresses. */
export type HostLookup = (hostname: string) => Promise<string[]>;

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
  maxRedirects?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const DEFAULT_PORTS: Record<string, number> = {
  "http:": 80,
  "https:": 443,
};

// Ask servers not to compress, so the bytes read and capped are the file
// itself. Mirror the previous client's user agent; some hosts reject requests
// without one.
const ACCEPT_ENCODING = "identity";
const USER_AGENT = "node";

const V4_MAPPED_DOTTED = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const V4_MAPPED_SUFFIX_HEX = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;
const V4_MAPPED_PREFIX = "::ffff:";
const NAT64_PREFIX = "64:ff9b:";
const SIX_TO_FOUR = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/;
const LEADING_BRACKET = /^\[/;
const TRAILING_BRACKET = /\]$/;

const V4_BYTE = 256;

// IPv4 ranges that must never be reachable: this host, private networks,
// link-local (incl. 169.254.169.254 cloud metadata), CGNAT, and reserved space.
const V4_PRIVATE_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function ipv4ToInt(ip: string): number {
  let value = 0;
  for (const part of ip.split(".")) {
    value = value * V4_BYTE + Number(part);
  }
  return value;
}

// Compare CIDR membership with arithmetic (this codebase forbids bitwise ops):
// two addresses share a /bits prefix when they fall in the same block of size
// 2^(32-bits).
function isPrivateV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return V4_PRIVATE_BLOCKS.some(([base, bits]) => {
    const blockSize = 2 ** (32 - bits);
    return (
      Math.floor(value / blockSize) === Math.floor(ipv4ToInt(base) / blockSize)
    );
  });
}

/** Pull the embedded IPv4 out of an IPv4-mapped or NAT64 IPv6 address. */
function mappedV4(addr: string): null | string {
  if (addr.startsWith(V4_MAPPED_PREFIX)) {
    const rest = addr.slice(V4_MAPPED_PREFIX.length);
    if (V4_MAPPED_DOTTED.test(rest)) {
      return rest;
    }
    const hex = V4_MAPPED_SUFFIX_HEX.exec(rest);
    if (hex) {
      return hexPairToV4(hex[1], hex[2]);
    }
    return null;
  }

  // NAT64 (64:ff9b::/96) embeds an IPv4 address in its last 32 bits.
  if (addr.startsWith(NAT64_PREFIX)) {
    const rest = addr.slice(NAT64_PREFIX.length);
    if (V4_MAPPED_DOTTED.test(rest)) {
      return rest;
    }
    const groups = rest.split(":").filter(Boolean);
    if (groups.length === 0) {
      return "0.0.0.0";
    }
    if (groups.length === 1) {
      return hexPairToV4("0", groups[0]);
    }
    if (groups.length === 2) {
      return hexPairToV4(groups[0], groups[1]);
    }
  }

  return null;
}

function hexPairToV4(highHex: string, lowHex: string): string {
  const high = Number.parseInt(highHex, 16);
  const low = Number.parseInt(lowHex, 16);
  return `${Math.floor(high / V4_BYTE)}.${high % V4_BYTE}.${Math.floor(low / V4_BYTE)}.${low % V4_BYTE}`;
}

function isPrivateV6(ip: string): boolean {
  const addr = ip.toLowerCase();

  const mapped = mappedV4(addr);
  if (mapped) {
    return isPrivateV4(mapped);
  }

  if (addr === "::1" || addr === "::") {
    return true;
  }

  // Deprecated IPv4-compatible (::/96) and other ::-prefixed forms are either
  // an embedded IPv4 or reserved space; none of them is public unicast.
  if (addr.startsWith("::")) {
    const rest = addr.slice(2);
    if (V4_MAPPED_DOTTED.test(rest)) {
      return isPrivateV4(rest);
    }
    const hex = V4_MAPPED_SUFFIX_HEX.exec(rest);
    if (hex) {
      return isPrivateV4(hexPairToV4(hex[1], hex[2]));
    }
    return true;
  }

  // 6to4 (2002::/16) embeds the relayed IPv4 address in the next 32 bits.
  const sixToFour = SIX_TO_FOUR.exec(addr);
  if (sixToFour) {
    return isPrivateV4(hexPairToV4(sixToFour[1], sixToFour[2]));
  }

  const head = addr.split(":")[0];
  if (!head) {
    return false;
  }

  const first = Number.parseInt(head, 16);
  const isUniqueLocal = first >= 0xfc_00 && first <= 0xfd_ff;
  const isLinkLocal = first >= 0xfe_80 && first <= 0xfe_bf;
  const isMulticast = first >= 0xff_00;
  // 0100::/8 (includes the 100::/64 discard-only prefix) is IETF-reserved.
  const isIetfReserved = first >= 0x01_00 && first <= 0x01_ff;
  return isUniqueLocal || isLinkLocal || isMulticast || isIetfReserved;
}

/**
 * True for any address that is not publicly routable (loopback, private,
 * link-local, reserved) or not a valid IP at all. Conservative by design: an
 * unparseable address is treated as unsafe.
 */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return isPrivateV4(ip);
  }
  if (family === 6) {
    return isPrivateV6(ip);
  }
  return true;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((result) => result.address);
}

/**
 * Validate that a URL is http(s) and resolves only to public addresses. Returns
 * the parsed URL. Throws an agent-recoverable error otherwise.
 */
export async function assertPublicUrl(
  url: string,
  lookup: HostLookup = defaultLookup
): Promise<URL> {
  const { parsed } = await validateUrlAddresses(url, lookup);
  return parsed;
}

/**
 * Validate a URL and return the parsed URL together with every address that
 * passed validation, so the connection can be pinned to exactly those. If the
 * hostname resolves to several addresses and ANY is non-public, the whole
 * request is rejected (fail closed).
 */
async function validateUrlAddresses(
  url: string,
  lookup: HostLookup
): Promise<{ parsed: URL; addresses: string[] }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported URL scheme "${parsed.protocol}". Only http and https are allowed.`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(`URL must not include credentials: ${url}`);
  }

  const host = parsed.hostname
    .replace(LEADING_BRACKET, "")
    .replace(TRAILING_BRACKET, "");
  if (!host) {
    throw new Error(`URL has no host: ${url}`);
  }

  const addresses = isIP(host) ? [host] : await lookup(host);
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${host}`);
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(
        `Refusing to fetch a private or reserved address (${address}) for host ${host}.`
      );
    }
  }

  return { parsed, addresses };
}

/** Copy node:http response headers into a web Headers object. */
function toWebHeaders(incoming: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  return headers;
}

/** The response encoding when it is not the identity encoding we asked for. */
function unsupportedEncoding(incoming: http.IncomingMessage): null | string {
  const encoding = incoming.headers["content-encoding"];
  if (!encoding || encoding.toLowerCase() === ACCEPT_ENCODING) {
    return null;
  }
  return encoding;
}

/**
 * Perform a single HTTP(S) request whose TCP connection can only go to the
 * given, already-validated address. The custom `lookup` returns that address
 * verbatim, so no second DNS resolution (and thus no rebinding window) exists
 * between validation and connect. TLS SNI, the certificate check, and the
 * `Host` header still use the original hostname. The response is converted to
 * a web `Response` so callers can stream it with the usual APIs.
 *
 * Exported for tests only. Application code must go through `safeFetch`, which
 * validates the URL and picks the address.
 *
 * @internal
 */
export function pinnedRequest(
  url: URL,
  address: string,
  signal?: AbortSignal
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const port = url.port
      ? Number(url.port)
      : (DEFAULT_PORTS[url.protocol] ?? 80);

    // Return the single pinned address in the shape http.request expects.
    // node:http calls lookup with { all: true } and consumes the array form.
    const lookup = (
      _hostname: string,
      options: { all?: boolean },
      callback: (
        error: NodeJS.ErrnoException | null,
        address: string | { address: string; family: number }[],
        family?: number
      ) => void
    ): void => {
      const family = isIP(address) === 6 ? 6 : 4;
      if (options?.all) {
        callback(null, [{ address, family }]);
        return;
      }
      callback(null, address, family);
    };

    const request = transport.request(
      {
        host: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        lookup,
        setHost: false,
        headers: {
          Host: url.host,
          "accept-encoding": ACCEPT_ENCODING,
          "user-agent": USER_AGENT,
        },
        signal,
      },
      (incoming) => {
        const encoding = unsupportedEncoding(incoming);
        if (encoding) {
          incoming.destroy();
          reject(
            new Error(
              `Refusing a compressed response (content-encoding: ${encoding}) for ${url.href}; the server ignored accept-encoding: ${ACCEPT_ENCODING}.`
            )
          );
          return;
        }

        const body = Readable.toWeb(
          incoming
        ) as unknown as ReadableStream<Uint8Array>;
        resolve(
          new Response(body, {
            status: incoming.statusCode ?? 0,
            headers: toWebHeaders(incoming),
          })
        );
      }
    );

    request.on("error", reject);
    request.end();
  });
}

/**
 * Fetch a URL, following redirects manually so every hop is re-resolved,
 * re-validated, and pinned to the addresses validated for that hop. When a
 * `fetchImpl` is injected it is used as-is (tests); otherwise the request is
 * made with node:http/https pinned to the validated address. Returns the final
 * (non-redirect) response without reading its body.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const {
    fetchImpl,
    lookup,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    signal,
  } = options;

  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const { parsed, addresses } = await validateUrlAddresses(
      currentUrl,
      lookup ?? defaultLookup
    );

    const response = fetchImpl
      ? await fetchImpl(parsed.href, { redirect: "manual", signal })
      : await pinnedRequest(parsed, addresses[0], signal);

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    currentUrl = new URL(location, parsed).href;
  }

  throw new Error(`Too many redirects while fetching ${url}`);
}

/**
 * Read a response body into a Buffer, aborting if it exceeds `maxBytes`. Reads
 * incrementally so an oversized or unbounded body never fully buffers.
 */
export async function readBodyCapped(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Response exceeds the ${maxBytes}-byte limit`);
    }
    return buffer;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  let chunk = await reader.read();

  while (!chunk.done) {
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds the ${maxBytes}-byte limit`);
    }
    chunks.push(Buffer.from(chunk.value));
    chunk = await reader.read();
  }

  return Buffer.concat(chunks);
}
