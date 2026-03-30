import type { Payload, Where } from "payload";
import {
  formatCollectionNotFoundError,
  formatValidationError,
} from "../output/errors.js";
import type { OutputOptions } from "../output/formatter.js";
import { info, output } from "../output/formatter.js";
import { buildLocaleArgs } from "../utils/locale.js";
import { parseFlags, positionalArgs } from "../utils/parse-flags.js";
import { getCollectionSlugs } from "../utils/schema-introspection.js";

/**
 * payload-agent delete <collection> <id> [--confirm] [--dry-run] [--locale <code>]
 *
 * Without --confirm: shows what would be deleted but does NOT delete.
 * With --confirm: executes the delete.
 * --locale affects the preview read only (deletes always remove the full document).
 */
export async function deleteCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { confirm?: boolean; dryRun?: boolean }
): Promise<void> {
  const pos = positionalArgs(args);
  const slug = pos[0];
  const id = pos[1];

  if (!(slug && id)) {
    console.error("Usage: payload-agent delete <collection> <id> [--confirm]");
    process.exit(1);
  }

  const collections = getCollectionSlugs(payload);
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections));
    process.exit(1);
  }

  const flags = parseFlags(args);
  const localeArgs = buildLocaleArgs(payload, flags);

  // Always preview first
  try {
    const doc = await payload.findByID({
      collection: slug as Parameters<typeof payload.findByID>[0]["collection"],
      id,
      ...localeArgs,
    });

    if (!opts.confirm || opts.dryRun) {
      info(`Would delete from '${slug}':`);
      output(doc, opts);
      console.error("");
      console.error("Run again with --confirm to execute the delete.");
      return;
    }

    // Execute delete
    await payload.delete({
      collection: slug as Parameters<typeof payload.delete>[0]["collection"],
      id,
      context: { disableRevalidate: true },
    });

    console.log(`Deleted document '${id}' from '${slug}'.`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("not found") || errMsg.includes("Not Found")) {
      console.error(
        `Error: Document '${id}' not found in collection '${slug}'.`
      );
    } else {
      console.error(formatValidationError(error, slug));
    }
    process.exit(1);
  }
}

/**
 * payload-agent delete-many <collection> --where '{...}' [--confirm] [--dry-run] [--locale <code>]
 *
 * Without --confirm: shows what would be deleted but does NOT delete.
 * With --confirm: executes the bulk delete.
 * --locale affects the preview read only (deletes always remove the full document).
 */
export async function deleteManyCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { confirm?: boolean; dryRun?: boolean }
): Promise<void> {
  const pos = positionalArgs(args);
  const slug = pos[0];
  if (!slug) {
    console.error(
      "Usage: payload-agent delete-many <collection> --where '{...}' [--confirm]"
    );
    process.exit(1);
  }

  const collections = getCollectionSlugs(payload);
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections));
    process.exit(1);
  }

  const flags = parseFlags(args);
  const localeArgs = buildLocaleArgs(payload, flags);

  if (!flags.where) {
    console.error("Error: --where flag is required for delete-many.");
    console.error("This prevents accidentally deleting all documents.");
    console.error("To delete all documents, use --where '{}'");
    process.exit(1);
  }

  let where: Where;
  try {
    where = JSON.parse(flags.where) as Where;
  } catch {
    console.error("Error: Invalid JSON in --where flag.");
    process.exit(1);
    return;
  }

  // Preview: find matching docs
  const preview = await payload.find({
    collection: slug as Parameters<typeof payload.find>[0]["collection"],
    where,
    limit: 10,
    ...localeArgs,
  });

  if (preview.totalDocs === 0) {
    console.log(
      `No documents match the given criteria in '${slug}'. Nothing to delete.`
    );
    return;
  }

  if (!opts.confirm || opts.dryRun) {
    info(`Would delete ${preview.totalDocs} document(s) from '${slug}':`);
    output(preview.docs, opts);
    if (preview.totalDocs > 10) {
      console.error(`  ... and ${preview.totalDocs - 10} more`);
    }
    console.error("");
    console.error("Run again with --confirm to execute the delete.");
    return;
  }

  // Execute bulk delete
  try {
    const result = await payload.delete({
      collection: slug as Parameters<typeof payload.delete>[0]["collection"],
      where,
      context: { disableRevalidate: true },
    });

    const docs =
      "docs" in result ? (result as { docs: unknown[] }).docs : [result];

    if (opts.json) {
      output(result, opts);
    } else {
      console.log(`Deleted ${docs.length} document(s) from '${slug}'.`);
    }
  } catch (error) {
    console.error(formatValidationError(error, slug));
    process.exit(1);
  }
}
