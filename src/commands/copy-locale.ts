import type { Field, Payload, Where } from "payload";
import {
  formatCollectionNotFoundError,
  formatGlobalNotFoundError,
  formatValidationError,
} from "../output/errors.js";
import type { OutputOptions } from "../output/formatter.js";
import { info, output } from "../output/formatter.js";
import { validateLocale } from "../utils/locale.js";
import { parseFlags, positionalArgs } from "../utils/parse-flags.js";
import {
  extractFieldsInfo,
  type FieldInfo,
  getCollectionSlugs,
  getGlobalSlugs,
} from "../utils/schema-introspection.js";

/**
 * Recursively collect all localized field names from a FieldInfo tree.
 * Returns a flat list of dot-path names for display purposes.
 */
function collectLocalizedFieldNames(
  fieldInfos: FieldInfo[],
  prefix = ""
): string[] {
  const names: string[] = [];
  for (const field of fieldInfos) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    if (field.localized) {
      names.push(path);
    }
    if (field.fields && field.fields.length > 0) {
      names.push(...collectLocalizedFieldNames(field.fields, path));
    }
  }
  return names;
}

/**
 * Check if any field in the tree (at any depth) is localized.
 */
function hasAnyLocalizedField(fieldInfos: FieldInfo[]): boolean {
  for (const field of fieldInfos) {
    if (field.localized) {
      return true;
    }
    if (field.fields && hasAnyLocalizedField(field.fields)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract only localized field values from a data object,
 * guided by the schema's FieldInfo tree.
 *
 * Non-localized fields are skipped entirely. For nested structures
 * (groups, arrays, blocks), only the localized sub-fields are kept.
 */
function extractLocalizedFields(
  data: Record<string, unknown>,
  fieldInfos: FieldInfo[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fieldInfos) {
    const value = data[field.name];
    if (value === undefined) {
      continue;
    }

    if (field.localized) {
      // This field is localized — include its value directly
      result[field.name] = value;
    } else if (field.fields && field.fields.length > 0) {
      // Non-localized container (group, array, blocks) — recurse into children
      // to find any localized descendants
      if (
        field.type === "group" &&
        typeof value === "object" &&
        value !== null
      ) {
        const nested = extractLocalizedFields(
          value as Record<string, unknown>,
          field.fields
        );
        if (Object.keys(nested).length > 0) {
          result[field.name] = nested;
        }
      } else if (field.type === "array" && Array.isArray(value)) {
        const nestedArray = value
          .map((item) => {
            if (typeof item !== "object" || item === null) {
              return null;
            }
            const nested = extractLocalizedFields(
              item as Record<string, unknown>,
              field.fields!
            );
            if (Object.keys(nested).length === 0) {
              return null;
            }
            // Preserve the item ID for Payload to match array rows
            const itemObj = item as Record<string, unknown>;
            if (itemObj.id) {
              nested.id = itemObj.id;
            }
            return nested;
          })
          .filter(Boolean);
        if (nestedArray.length > 0) {
          result[field.name] = nestedArray;
        }
      } else if (field.type === "blocks" && Array.isArray(value)) {
        // Blocks: each block has a blockType and its own fields
        const nestedBlocks = value
          .map((block) => {
            if (typeof block !== "object" || block === null) {
              return null;
            }
            const blockObj = block as Record<string, unknown>;
            const blockType = blockObj.blockType as string;
            // Find the block definition in the schema
            const blockDef = field.fields!.find((f) => f.name === blockType);
            if (!blockDef?.fields) {
              return null;
            }
            const nested = extractLocalizedFields(blockObj, blockDef.fields);
            if (Object.keys(nested).length === 0) {
              return null;
            }
            // Preserve block identity
            nested.blockType = blockType;
            if (blockObj.id) {
              nested.id = blockObj.id;
            }
            return nested;
          })
          .filter(Boolean);
        if (nestedBlocks.length > 0) {
          result[field.name] = nestedBlocks;
        }
      }
    }
  }

  return result;
}

/**
 * payload-agent copy-locale <collection> [<id>] --from <locale> --to <locale> [--where '{...}'] [--dry-run]
 *
 * Copies all localized field values from one locale to another.
 * If <id> is provided, copies for a single document.
 * If --where is provided, copies for matching documents.
 * If neither, copies for ALL documents in the collection.
 */
export async function copyLocaleCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean }
): Promise<void> {
  const pos = positionalArgs(args);
  const slug = pos[0];
  const singleId = pos[1]; // optional

  if (!slug) {
    console.error(
      "Usage: payload-agent copy-locale <collection> [<id>] --from <locale> --to <locale> [--where '{...}'] [--dry-run]"
    );
    process.exit(1);
  }

  const collections = getCollectionSlugs(payload);
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections));
    process.exit(1);
  }

  const flags = parseFlags(args);

  if (!(flags.from && flags.to)) {
    console.error("Error: --from and --to flags are required.");
    console.error(
      "Example: payload-agent copy-locale products --from sk --to cz"
    );
    process.exit(1);
  }

  const fromLocale = validateLocale(payload, flags.from);
  const toLocale = validateLocale(payload, flags.to);

  if (fromLocale === toLocale) {
    console.error(
      `Error: --from and --to cannot be the same locale ("${fromLocale}").`
    );
    process.exit(1);
  }

  if (fromLocale === "all" || toLocale === "all") {
    console.error(
      'Error: "all" is not valid for copy-locale. Use specific locale codes.'
    );
    process.exit(1);
  }

  // Get schema to identify localized fields
  const collection = payload.config.collections.find((c) => c.slug === slug);
  if (!collection) {
    console.error(`Error: Collection '${slug}' not found.`);
    process.exit(1);
    return;
  }
  const fieldInfos = extractFieldsInfo(collection.fields as Field[]);

  if (!hasAnyLocalizedField(fieldInfos)) {
    console.log(`No localized fields found in '${slug}'. Nothing to copy.`);
    return;
  }

  const localizedFieldNames = collectLocalizedFieldNames(fieldInfos);
  info(`Localized fields: ${localizedFieldNames.join(", ")}`);

  // Determine which documents to process
  let where: Where | undefined;
  if (singleId) {
    // Single document mode
    where = { id: { equals: singleId } };
  } else if (flags.where) {
    try {
      where = JSON.parse(flags.where) as Where;
    } catch {
      console.error("Error: Invalid JSON in --where flag.");
      process.exit(1);
      return;
    }
  }

  // Fetch all matching documents
  let allDocs: Array<Record<string, unknown>> = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const result = await payload.find({
      collection: slug as Parameters<typeof payload.find>[0]["collection"],
      locale: fromLocale,
      depth: 0,
      limit,
      page,
      ...(where ? { where } : {}),
    });

    allDocs = allDocs.concat(result.docs as Array<Record<string, unknown>>);

    if (!result.hasNextPage) {
      break;
    }
    page++;
  }

  if (allDocs.length === 0) {
    console.log("No documents found matching the criteria.");
    return;
  }

  info(
    `Found ${allDocs.length} document(s) to copy locale ${fromLocale} → ${toLocale}.`
  );

  if (opts.dryRun) {
    // Show what would be copied for the first document
    const sample = extractLocalizedFields(allDocs[0], fieldInfos);
    info("\nDry run: would copy these localized fields for each document:");
    output(sample, opts);
    return;
  }

  let copied = 0;
  let errors = 0;

  for (const doc of allDocs) {
    const localizedData = extractLocalizedFields(doc, fieldInfos);
    if (Object.keys(localizedData).length === 0) {
      continue;
    }

    try {
      await payload.update({
        collection: slug as Parameters<typeof payload.update>[0]["collection"],
        id: doc.id as string,
        locale: toLocale,
        data: localizedData,
        context: { disableRevalidate: true },
      });
      copied++;
    } catch (error) {
      errors++;
      console.error(
        `Error copying locale for document '${doc.id}': ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (copied % 25 === 0 && copied > 0) {
      info(`  Copied ${copied}/${allDocs.length}...`);
    }
  }

  console.log(
    `Copied locale ${fromLocale} → ${toLocale} for ${copied} document(s) in '${slug}'.${errors > 0 ? ` (${errors} error(s))` : ""}`
  );
}

/**
 * payload-agent copy-locale-global <slug> --from <locale> --to <locale> [--dry-run]
 *
 * Copies all localized field values from one locale to another for a global.
 */
export async function copyLocaleGlobalCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean }
): Promise<void> {
  const pos = positionalArgs(args);
  const slug = pos[0];

  if (!slug) {
    console.error(
      "Usage: payload-agent copy-locale-global <slug> --from <locale> --to <locale> [--dry-run]"
    );
    process.exit(1);
  }

  const globals = getGlobalSlugs(payload);
  if (!globals.includes(slug)) {
    console.error(formatGlobalNotFoundError(slug, globals));
    process.exit(1);
  }

  const flags = parseFlags(args);

  if (!(flags.from && flags.to)) {
    console.error("Error: --from and --to flags are required.");
    console.error(
      "Example: payload-agent copy-locale-global header --from sk --to cz"
    );
    process.exit(1);
  }

  const fromLocale = validateLocale(payload, flags.from);
  const toLocale = validateLocale(payload, flags.to);

  if (fromLocale === toLocale) {
    console.error(
      `Error: --from and --to cannot be the same locale ("${fromLocale}").`
    );
    process.exit(1);
  }

  if (fromLocale === "all" || toLocale === "all") {
    console.error(
      'Error: "all" is not valid for copy-locale-global. Use specific locale codes.'
    );
    process.exit(1);
  }

  // Get schema
  const global = payload.config.globals?.find((g) => g.slug === slug);
  if (!global) {
    console.error(`Error: Global '${slug}' not found.`);
    process.exit(1);
    return;
  }
  const fieldInfos = extractFieldsInfo(global.fields as Field[]);

  if (!hasAnyLocalizedField(fieldInfos)) {
    console.log(
      `No localized fields found in global '${slug}'. Nothing to copy.`
    );
    return;
  }

  const localizedFieldNames = collectLocalizedFieldNames(fieldInfos);

  info(`Localized fields: ${localizedFieldNames.join(", ")}`);

  // Read the global with source locale
  const doc = await payload.findGlobal({
    slug: slug as Parameters<typeof payload.findGlobal>[0]["slug"],
    locale: fromLocale,
    depth: 0,
  });

  const localizedData = extractLocalizedFields(
    doc as unknown as Record<string, unknown>,
    fieldInfos
  );

  if (Object.keys(localizedData).length === 0) {
    console.log("No localized field values found to copy.");
    return;
  }

  if (opts.dryRun) {
    info(
      `Dry run: would copy these localized fields from ${fromLocale} → ${toLocale}:`
    );
    output(localizedData, opts);
    return;
  }

  try {
    await payload.updateGlobal({
      slug: slug as Parameters<typeof payload.updateGlobal>[0]["slug"],
      locale: toLocale,
      data: localizedData as Record<string, unknown>,
      context: { disableRevalidate: true },
    });

    console.log(
      `Copied locale ${fromLocale} → ${toLocale} for global '${slug}'.`
    );
  } catch (error) {
    console.error(formatValidationError(error));
    process.exit(1);
  }
}
