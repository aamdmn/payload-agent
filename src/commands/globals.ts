import type { Field, GlobalConfig, Payload } from "payload";
import {
  formatGlobalNotFoundError,
  formatValidationError,
} from "../output/errors.js";
import type { OutputOptions } from "../output/formatter.js";
import { info, output, table } from "../output/formatter.js";
import { parseDataFlag } from "../utils/data-parse.js";
import { buildLocaleArgs, validateLocale } from "../utils/locale.js";
import { parseFlags, positionalArgs } from "../utils/parse-flags.js";
import {
  extractFieldsInfo,
  getGlobalSlugs,
} from "../utils/schema-introspection.js";

/**
 * payload-agent globals - List all globals.
 */
export async function globalsCommand(
  payload: Payload,
  _args: string[],
  opts: Partial<OutputOptions>
): Promise<void> {
  const globals = payload.config.globals || [];

  if (opts.json) {
    output(
      globals.map((g: GlobalConfig) => ({
        slug: g.slug,
        label: typeof g.label === "string" ? g.label : g.slug,
        fieldCount: extractFieldsInfo(g.fields as Field[]).length,
      })),
      opts
    );
    return;
  }

  if (globals.length === 0) {
    console.log("No globals configured.");
    return;
  }

  const headers = ["slug", "fields"];
  const rows = globals.map((g: GlobalConfig) => [
    g.slug,
    String(extractFieldsInfo(g.fields as Field[]).length),
  ]);

  console.log(table(headers, rows));
  console.error(`\n${globals.length} global(s)`);
}

/**
 * payload-agent get-global <slug> [--select '...'] [--depth N] [--locale <code>] [--fallback-locale <code>]
 */
export async function getGlobalCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions>
): Promise<void> {
  const pos = positionalArgs(args);
  const slug = pos[0];
  if (!slug) {
    console.error(
      "Usage: payload-agent get-global <slug> [--select '{...}'] [--depth N] [--locale <code>]"
    );
    process.exit(1);
  }

  const globals = getGlobalSlugs(payload);
  if (!globals.includes(slug)) {
    console.error(formatGlobalNotFoundError(slug, globals));
    process.exit(1);
  }

  const flags = parseFlags(args);
  const findArgs: Record<string, unknown> = {
    slug,
    ...buildLocaleArgs(payload, flags),
  };

  if (flags.depth) {
    findArgs.depth = Number.parseInt(flags.depth, 10);
  }
  if (flags.select) {
    try {
      findArgs.select = JSON.parse(flags.select);
    } catch {
      console.error("Error: Invalid JSON in --select flag.");
      process.exit(1);
    }
  }

  try {
    const result = await payload.findGlobal(
      findArgs as Parameters<typeof payload.findGlobal>[0]
    );
    output(result, opts);
  } catch (error) {
    console.error(formatValidationError(error));
    process.exit(1);
  }
}

/**
 * payload-agent update-global <slug> --data '{...}' [--locale <code>] [--dry-run]
 */
export async function updateGlobalCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean }
): Promise<void> {
  const pos = positionalArgs(args);
  const slug = pos[0];
  if (!slug) {
    console.error(
      "Usage: payload-agent update-global <slug> --data '{...}' [--locale <code>] [--dry-run]"
    );
    process.exit(1);
  }

  const globals = getGlobalSlugs(payload);
  if (!globals.includes(slug)) {
    console.error(formatGlobalNotFoundError(slug, globals));
    process.exit(1);
  }

  const flags = parseFlags(args);

  if (!flags.data) {
    console.error("Error: --data flag is required.");
    console.error(
      `Hint: Run 'payload-agent describe ${slug}' to see available fields.`
    );
    process.exit(1);
  }

  const data = parseDataFlag(flags.data);
  const locale = flags.locale
    ? validateLocale(payload, flags.locale)
    : undefined;

  if (opts.dryRun) {
    const target = locale
      ? `global '${slug}' (locale: ${locale})`
      : `global '${slug}'`;
    info(`Dry run: would update ${target} with data:`);
    output(data, opts);
    return;
  }

  try {
    const result = await payload.updateGlobal({
      slug: slug as Parameters<typeof payload.updateGlobal>[0]["slug"],
      data: data as Record<string, unknown>,
      ...(locale ? { locale } : {}),
      context: { disableRevalidate: true },
    });

    if (opts.json) {
      output(result, opts);
    } else {
      const msg = locale
        ? `Updated global '${slug}' (locale: ${locale}).`
        : `Updated global '${slug}'.`;
      console.log(msg);
      output(result, opts);
    }
  } catch (error) {
    console.error(formatValidationError(error));
    process.exit(1);
  }
}
