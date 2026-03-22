import type { Payload } from "payload";
import {
  formatCollectionNotFoundError,
  formatValidationError,
  suggestField,
} from "../output/errors.js";
import type { OutputOptions } from "../output/formatter.js";
import { info, output } from "../output/formatter.js";
import { readFileForUpload } from "../utils/file-utils.js";
import {
  parseFlags,
  parseFlagsMulti,
  positionalArgs,
} from "../utils/parse-flags.js";
import {
  getCollectionSlugs,
  getFieldNames,
  isUploadCollection,
  resolveUploadCollection,
} from "../utils/schema-introspection.js";

/**
 * Parse --file flag values into field path + file path pairs.
 * Format: --file 'fieldPath=./filePath'
 */
function parseFileFlags(
  fileFlags: string[]
): Array<{ fieldPath: string; filePath: string }> {
  return fileFlags.map((flag) => {
    const eqIndex = flag.indexOf("=");
    if (eqIndex === -1) {
      console.error(
        `Error: Invalid --file format '${flag}'. Expected 'fieldPath=./filePath'.`
      );
      console.error("Example: --file 'heroImage=./hero.jpg'");
      process.exit(1);
    }
    return {
      fieldPath: flag.slice(0, eqIndex),
      filePath: flag.slice(eqIndex + 1),
    };
  });
}

/**
 * Set a value at a dot-path in an object, creating intermediate objects as needed.
 * e.g. setNestedValue(obj, 'layout.0.image', '123') sets obj.layout[0].image = '123'
 */
function setNestedValue(
  obj: Record<string, unknown>,
  dotPath: string,
  value: unknown
): void {
  const segments = dotPath.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];
    const isNextNumeric = /^\d+$/.test(nextSegment);

    if (current[segment] === undefined || current[segment] === null) {
      current[segment] = isNextNumeric ? [] : {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  current[segments[segments.length - 1]] = value;
}

/**
 * Upload files specified by --file flags, returning the updated data object
 * with uploaded document IDs injected at the specified field paths.
 */
async function processFileFlags(
  payload: Payload,
  collectionSlug: string,
  data: Record<string, unknown>,
  fileFlags: Array<{ fieldPath: string; filePath: string }>,
  dryRun?: boolean
): Promise<Record<string, unknown>> {
  for (const { fieldPath, filePath } of fileFlags) {
    // Resolve which upload collection this field targets
    const resolution = resolveUploadCollection(
      payload,
      collectionSlug,
      fieldPath
    );

    if ("error" in resolution) {
      console.error(`Error: ${resolution.error}`);
      process.exit(1);
    }

    const uploadSlug = resolution.collection;

    if (dryRun) {
      info(
        `  --file: would upload '${filePath}' to '${uploadSlug}' for field '${fieldPath}'`
      );
      continue;
    }

    // Read and upload the file
    let file: Awaited<ReturnType<typeof readFileForUpload>>;
    try {
      file = await readFileForUpload(filePath);
    } catch (error) {
      console.error(
        `Error reading file for '${fieldPath}': ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
      return data;
    }

    try {
      const result = await payload.create({
        collection: uploadSlug as Parameters<
          typeof payload.create
        >[0]["collection"],
        data: {},
        file,
        context: { disableRevalidate: true },
      });

      const resultObj = result as Record<string, unknown>;
      console.log(
        `Uploaded '${file.name}' to '${uploadSlug}' (id: ${resultObj.id}) for field '${fieldPath}'`
      );

      // Inject the uploaded document's ID into the data at the field path
      setNestedValue(data, fieldPath, resultObj.id);
    } catch (error) {
      console.error(`Error uploading file for '${fieldPath}':`);
      console.error(formatValidationError(error, uploadSlug));
      process.exit(1);
    }
  }

  return data;
}

/**
 * payload-agent create <collection> --data '{...}' [--file 'field=./path'] [--dry-run]
 */
export async function createCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean }
): Promise<void> {
  const pos = positionalArgs(args);
  const slug = pos[0];
  if (!slug) {
    console.error(
      "Usage: payload-agent create <collection> --data '{...}' [--file 'field=./path'] [--dry-run]"
    );
    process.exit(1);
  }

  // Validate collection
  const collections = getCollectionSlugs(payload);
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections));
    process.exit(1);
  }

  const flags = parseFlags(args);
  const multiFlags = parseFlagsMulti(args);

  // For upload collections, --data is optional (file metadata is optional)
  const isUpload = isUploadCollection(payload, slug);

  if (!(flags.data || isUpload)) {
    console.error("Error: --data flag is required.");
    console.error(
      `Usage: payload-agent create ${slug} --data '{"title":"My Post"}'`
    );
    console.error(
      `Hint: Run 'payload-agent describe ${slug}' to see available fields.`
    );
    process.exit(1);
  }

  let data: Record<string, unknown> = {};
  if (flags.data) {
    try {
      data = JSON.parse(flags.data) as Record<string, unknown>;
    } catch {
      console.error("Error: Invalid JSON in --data flag.");
      console.error(`Example: --data '{"title":"My Post","status":"draft"}'`);
      process.exit(1);
      return;
    }
  }

  // Check for unknown field names and suggest corrections
  const knownFields = getFieldNames(payload, slug);
  if (knownFields.length > 0) {
    for (const key of Object.keys(data)) {
      if (!knownFields.includes(key)) {
        const suggestion = suggestField(key, knownFields);
        if (suggestion) {
          console.error(
            `Warning: Field '${key}' does not exist on '${slug}'. Did you mean '${suggestion}'?`
          );
        }
      }
    }
  }

  // Process --file flags: upload files and inject IDs into data
  const fileFlags = multiFlags.file || [];
  if (fileFlags.length > 0) {
    const parsed = parseFileFlags(fileFlags);
    data = await processFileFlags(payload, slug, data, parsed, opts.dryRun);
  }

  if (opts.dryRun) {
    info(`Dry run: would create document in '${slug}' with data:`);
    output(data, opts);
    return;
  }

  try {
    const result = await payload.create({
      collection: slug as Parameters<typeof payload.create>[0]["collection"],
      data: data as Record<string, unknown>,
      context: { disableRevalidate: true },
    });

    if (opts.json) {
      output(result, opts);
    } else {
      const resultObj = result as Record<string, unknown>;
      console.log(`Created document in '${slug}' with id: ${resultObj.id}`);
      output(result, opts);
    }
  } catch (error) {
    console.error(formatValidationError(error, slug, knownFields));
    process.exit(1);
  }
}
