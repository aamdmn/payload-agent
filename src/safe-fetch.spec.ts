import http from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertPublicUrl,
  isPrivateAddress,
  pinnedRequest,
  readBodyCapped,
  safeFetch,
} from "./safe-fetch.js";

const PRIVATE_ERROR = /private or reserved/;
const SCHEME_ERROR = /scheme/;
const REDIRECTS_ERROR = /redirects/;
const SIZE_ERROR = /limit/;
const CREDENTIALS_ERROR = /credentials/;
const GZIP_ENCODING_ERROR = /content-encoding: gzip/;

const HAS_V6_LOOPBACK = Object.values(networkInterfaces())
  .flat()
  .some((info) => info?.address === "::1");

const publicLookup = (): Promise<string[]> =>
  Promise.resolve(["93.184.216.34"]);

describe("isPrivateAddress", () => {
  test("flags loopback, private, link-local, reserved, and mapped addresses", () => {
    const blocked = [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.1",
      "172.16.5.4",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:127.0.0.1",
      "not-an-ip",
    ];

    for (const ip of blocked) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  test("flags the extended IPv4 and IPv6 reserved ranges", () => {
    const blocked = [
      // 0.0.0.0/8 beyond 0.0.0.0 itself
      "0.1.2.3",
      // CGNAT 100.64.0.0/10
      "100.64.0.1",
      "100.127.255.255",
      // benchmarking 198.18.0.0/15
      "198.18.0.1",
      "198.19.255.255",
      // multicast 224.0.0.0/4 and broadcast
      "224.0.0.1",
      "239.9.9.9",
      "255.255.255.255",
      // IPv4-mapped IPv6 in hex form
      "::ffff:7f00:1",
      "::ffff:a00:1",
      // NAT64 embedding a private IPv4 (hex and dotted)
      "64:ff9b::7f00:1",
      "64:ff9b::169.254.169.254",
      "64:ff9b::10.0.0.5",
      "64:ff9b::1",
      "64:ff9b::",
      // 6to4 relaying a private IPv4
      "2002:7f00:1::",
      // deprecated IPv4-compatible form for 127.0.0.1
      "::7f00:1",
      "::127.0.0.1",
      // IETF-reserved 0100::/8 (includes the 100::/64 discard-only prefix)
      "100::1",
    ];

    for (const ip of blocked) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  test("allows publicly routable addresses", () => {
    const allowed = [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "2606:4700:4700::1111",
      // CGNAT ends at 100.127.255.255
      "100.128.0.1",
      // NAT64 embedding a public IPv4
      "64:ff9b::808:808",
      // global unicast just above the reserved 0100::/8
      "200::1",
    ];

    for (const ip of allowed) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  test("rejects non-http(s) schemes", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(
      SCHEME_ERROR
    );
    await expect(assertPublicUrl("ftp://example.com/x")).rejects.toThrow(
      SCHEME_ERROR
    );
  });

  test("rejects a literal private address with no lookup needed", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/")).rejects.toThrow(
      PRIVATE_ERROR
    );
  });

  test("rejects a hostname that resolves to a private address", async () => {
    const lookup = (): Promise<string[]> => Promise.resolve(["10.0.0.5"]);

    await expect(
      assertPublicUrl("https://intranet.example/", lookup)
    ).rejects.toThrow(PRIVATE_ERROR);
  });

  test("rejects a hostname resolving to a mix of public and private addresses", async () => {
    const lookup = (): Promise<string[]> =>
      Promise.resolve(["93.184.216.34", "10.0.0.5"]);

    await expect(
      assertPublicUrl("https://mixed.example/", lookup)
    ).rejects.toThrow(PRIVATE_ERROR);
  });

  test("rejects URLs that embed credentials", async () => {
    await expect(
      assertPublicUrl("https://user:pass@example.com/x", publicLookup)
    ).rejects.toThrow(CREDENTIALS_ERROR);
  });

  test("accepts a public hostname", async () => {
    const parsed = await assertPublicUrl("https://example.com/a", publicLookup);

    expect(parsed.host).toBe("example.com");
  });
});

describe("safeFetch", () => {
  test("returns the response for a direct 200", async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response("body", { status: 200 }))) as typeof fetch;

    const response = await safeFetch("https://example.com/", {
      fetchImpl,
      lookup: publicLookup,
    });

    expect(response.status).toBe(200);
  });

  test("follows a redirect to another public URL", async () => {
    const calls: string[] = [];
    const fetchImpl = ((input: string) => {
      calls.push(input);
      if (calls.length === 1) {
        return Promise.resolve(
          Response.redirect("https://cdn.example.com/file", 302)
        );
      }
      return Promise.resolve(new Response("data", { status: 200 }));
    }) as unknown as typeof fetch;

    const response = await safeFetch("https://example.com/", {
      fetchImpl,
      lookup: publicLookup,
    });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  test("rejects a redirect that targets a private address", async () => {
    const fetchImpl = ((input: string) => {
      if (input.includes("example.com")) {
        return Promise.resolve(
          Response.redirect("http://169.254.169.254/", 302)
        );
      }
      return Promise.resolve(new Response("secret", { status: 200 }));
    }) as unknown as typeof fetch;

    await expect(
      safeFetch("https://example.com/", { fetchImpl, lookup: publicLookup })
    ).rejects.toThrow(PRIVATE_ERROR);
  });

  test("throws after too many redirects", async () => {
    let count = 0;
    const fetchImpl = (() => {
      count += 1;
      return Promise.resolve(
        Response.redirect(`https://example.com/${count}`, 302)
      );
    }) as unknown as typeof fetch;

    await expect(
      safeFetch("https://example.com/", {
        fetchImpl,
        lookup: publicLookup,
        maxRedirects: 2,
      })
    ).rejects.toThrow(REDIRECTS_ERROR);
  });

  test("rejects a redirect to a non-http(s) scheme", async () => {
    const redirected = (location: string) =>
      ((input: string) => {
        if (input.includes("example.com")) {
          return Promise.resolve(Response.redirect(location, 302));
        }
        return Promise.resolve(new Response("never", { status: 200 }));
      }) as unknown as typeof fetch;

    await expect(
      safeFetch("https://example.com/", {
        fetchImpl: redirected("ftp://files.example.com/x"),
        lookup: publicLookup,
      })
    ).rejects.toThrow(SCHEME_ERROR);
    await expect(
      safeFetch("https://example.com/", {
        fetchImpl: redirected("file:///etc/passwd"),
        lookup: publicLookup,
      })
    ).rejects.toThrow(SCHEME_ERROR);
  });
});

describe("pinnedRequest", () => {
  const requests: {
    acceptEncoding: string;
    host: string;
    method: string;
    remoteAddress: string;
    url: string;
    userAgent: string;
  }[] = [];
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push({
        acceptEncoding: req.headers["accept-encoding"] ?? "",
        host: req.headers.host ?? "",
        method: req.method ?? "",
        remoteAddress: req.socket.remoteAddress ?? "",
        url: req.url ?? "",
        userAgent: req.headers["user-agent"] ?? "",
      });
      if (req.url === "/redirect-to-file") {
        res.writeHead(302, { location: "file:///etc/passwd" });
        res.end();
        return;
      }
      if (req.url === "/never-ends") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("partial");
        return;
      }
      if (req.url === "/gzip") {
        const compressed = gzipSync("compressed payload");
        res.writeHead(200, {
          "content-encoding": "gzip",
          "content-length": String(compressed.length),
          "content-type": "text/plain",
        });
        res.end(compressed);
        return;
      }
      const body = `served ${req.url}`;
      res.writeHead(200, {
        "content-length": String(Buffer.byteLength(body)),
        "content-type": "text/plain",
      });
      res.end(body);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // `.example` is reserved (RFC 2606) and never resolves, so any successful
  // request proves the transport connected to the pinned address and never
  // consulted DNS for the hostname.
  test("connects to the pinned address and keeps the original Host", async () => {
    const response = await pinnedRequest(
      new URL(`http://rebind.example:${port}/data?q=1`),
      "127.0.0.1"
    );

    expect(response.status).toBe(200);
    const body = await readBodyCapped(response, 1024);
    expect(body.toString()).toBe("served /data?q=1");
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].remoteAddress).toBe("127.0.0.1");
    expect(requests[0].host).toBe(`rebind.example:${port}`);
    expect(requests[0].url).toBe("/data?q=1");
    // The consumer's content-length pre-check needs this header intact.
    expect(response.headers.get("content-length")).toBe(String(body.length));
  });

  test("asks for identity encoding and sends a user agent", async () => {
    await pinnedRequest(
      new URL(`http://rebind.example:${port}/headers`),
      "127.0.0.1"
    );

    const last = requests.at(-1);
    expect(last?.acceptEncoding).toBe("identity");
    expect(last?.userAgent).not.toBe("");
  });

  test("rejects a response the server compressed anyway", async () => {
    await expect(
      pinnedRequest(new URL(`http://rebind.example:${port}/gzip`), "127.0.0.1")
    ).rejects.toThrow(GZIP_ENCODING_ERROR);
  });

  test.skipIf(!HAS_V6_LOOPBACK)("pins IPv6 addresses", async () => {
    const v6Server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("v6");
    });
    await new Promise<void>((resolve) => {
      v6Server.listen(0, "::1", resolve);
    });

    const v6Port = (v6Server.address() as AddressInfo).port;
    try {
      const response = await pinnedRequest(
        new URL(`http://rebind.example:${v6Port}/v6`),
        "::1"
      );
      const body = await readBodyCapped(response, 1024);

      expect(body.toString()).toBe("v6");
    } finally {
      await new Promise<void>((resolve) => {
        v6Server.close(() => resolve());
      });
    }
  });

  test("returns the response status and headers for redirects", async () => {
    const response = await pinnedRequest(
      new URL(`http://rebind.example:${port}/redirect-to-file`),
      "127.0.0.1"
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("file:///etc/passwd");
  });

  test("aborts an in-flight request through the signal", async () => {
    const controller = new AbortController();
    const response = await pinnedRequest(
      new URL(`http://rebind.example:${port}/never-ends`),
      "127.0.0.1",
      controller.signal
    );

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    controller.abort();
    await expect(reader?.read()).rejects.toThrow();
  });
});

describe("safeFetch address pinning", () => {
  // Every hop resolves through the injected lookup, so a rebinding resolver
  // that answers public for the validator and private for the client cannot
  // slip past: there is no second resolution to poison.
  test("resolves and validates each hop exactly once", async () => {
    const lookups: string[] = [];
    const lookup = (hostname: string): Promise<string[]> => {
      lookups.push(hostname);
      return Promise.resolve(["93.184.216.34"]);
    };
    const fetched: string[] = [];
    const fetchImpl = ((input: string) => {
      fetched.push(input);
      if (fetched.length === 1) {
        return Promise.resolve(
          Response.redirect("https://cdn.example.com/next", 302)
        );
      }
      return Promise.resolve(new Response("done", { status: 200 }));
    }) as unknown as typeof fetch;

    const response = await safeFetch("https://origin.example/start", {
      fetchImpl,
      lookup,
    });

    expect(response.status).toBe(200);
    expect(lookups).toEqual(["origin.example", "cdn.example.com"]);
    expect(fetched).toEqual([
      "https://origin.example/start",
      "https://cdn.example.com/next",
    ]);
  });

  test("rejects a redirect whose second lookup is private", async () => {
    const lookup = (hostname: string): Promise<string[]> =>
      Promise.resolve(
        hostname === "origin.example" ? ["93.184.216.34"] : ["10.0.0.5"]
      );
    const fetchImpl = (() =>
      Promise.resolve(
        Response.redirect("https://rebind.example/secret", 302)
      )) as unknown as typeof fetch;

    await expect(
      safeFetch("https://origin.example/start", { fetchImpl, lookup })
    ).rejects.toThrow(PRIVATE_ERROR);
  });

  test("rejects literal IPv4-mapped and NAT64 hosts before connecting", async () => {
    await expect(safeFetch("http://[::ffff:7f00:1]/")).rejects.toThrow(
      PRIVATE_ERROR
    );
    await expect(safeFetch("http://[::7f00:1]/")).rejects.toThrow(
      PRIVATE_ERROR
    );
    await expect(safeFetch("http://[64:ff9b::7f00:1]/")).rejects.toThrow(
      PRIVATE_ERROR
    );
    await expect(safeFetch("http://[64:ff9b::a00:1]/")).rejects.toThrow(
      PRIVATE_ERROR
    );
  });
});

describe("readBodyCapped", () => {
  test("returns the buffer when under the cap", async () => {
    const buffer = await readBodyCapped(
      new Response(Buffer.from("hello")),
      1024
    );

    expect(buffer.toString()).toBe("hello");
  });

  test("throws when the body exceeds the cap", async () => {
    await expect(
      readBodyCapped(new Response(Buffer.alloc(2048)), 1024)
    ).rejects.toThrow(SIZE_ERROR);
  });
});
