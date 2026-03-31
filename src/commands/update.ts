import type { Payload, Where } from 'payload'
import {
  formatCollectionNotFoundError,
  formatValidationError,
  suggestField,
} from '../output/errors.js'
import type { OutputOptions } from '../output/formatter.js'
import { info, output } from '../output/formatter.js'
import { parseDataFlag } from '../utils/data-parse.js'
import { readFileForUpload } from '../utils/file-utils.js'
import { buildLocaleArgs, validateLocale } from '../utils/locale.js'
import { parseFlags, parseFlagsMulti, positionalArgs } from '../utils/parse-flags.js'
import {
  getCollectionSlugs,
  getFieldNames,
  isUploadCollection,
  resolveUploadCollection,
} from '../utils/schema-introspection.js'

/**
 * Parse --file flag values into field path + file path pairs.
 * Format: --file 'fieldPath=./filePath'
 */
function parseFileFlags(fileFlags: string[]): Array<{ fieldPath: string; filePath: string }> {
  return fileFlags.map((flag) => {
    const eqIndex = flag.indexOf('=')
    if (eqIndex === -1) {
      console.error(`Error: Invalid --file format '${flag}'. Expected 'fieldPath=./filePath'.`)
      console.error("Example: --file 'heroImage=./hero.jpg'")
      process.exit(1)
    }
    return {
      fieldPath: flag.slice(0, eqIndex),
      filePath: flag.slice(eqIndex + 1),
    }
  })
}

/**
 * Set a value at a dot-path in an object, creating intermediate objects as needed.
 */
function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const segments = dotPath.split('.')
  let current: Record<string, unknown> = obj

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    const nextSegment = segments[i + 1]
    const isNextNumeric = /^\d+$/.test(nextSegment)

    if (current[segment] === undefined || current[segment] === null) {
      current[segment] = isNextNumeric ? [] : {}
    }
    current = current[segment] as Record<string, unknown>
  }

  current[segments[segments.length - 1]] = value
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
  dryRun?: boolean,
): Promise<Record<string, unknown>> {
  for (const { fieldPath, filePath } of fileFlags) {
    const resolution = resolveUploadCollection(payload, collectionSlug, fieldPath)

    if ('error' in resolution) {
      console.error(`Error: ${resolution.error}`)
      process.exit(1)
    }

    const uploadSlug = resolution.collection

    if (dryRun) {
      info(`  --file: would upload '${filePath}' to '${uploadSlug}' for field '${fieldPath}'`)
      continue
    }

    let file: Awaited<ReturnType<typeof readFileForUpload>>
    try {
      file = await readFileForUpload(filePath)
    } catch (error) {
      console.error(
        `Error reading file for '${fieldPath}': ${error instanceof Error ? error.message : String(error)}`,
      )
      process.exit(1)
      return data
    }

    try {
      const result = await payload.create({
        collection: uploadSlug as Parameters<typeof payload.create>[0]['collection'],
        data: {},
        file,
        context: { disableRevalidate: true },
      })

      const resultObj = result as Record<string, unknown>
      console.log(
        `Uploaded '${file.name}' to '${uploadSlug}' (id: ${resultObj.id}) for field '${fieldPath}'`,
      )

      setNestedValue(data, fieldPath, resultObj.id)
    } catch (error) {
      console.error(`Error uploading file for '${fieldPath}':`)
      console.error(formatValidationError(error, uploadSlug))
      process.exit(1)
    }
  }

  return data
}

/**
 * payload-agent update <collection> <id> --data '{...}' [--locale <code>] [--file 'field=./path'] [--dry-run]
 */
export async function updateCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean },
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]
  const id = pos[1]

  if (!(slug && id)) {
    console.error(
      "Usage: payload-agent update <collection> <id> --data '{...}' [--locale <code>] [--file 'field=./path'] [--dry-run]",
    )
    process.exit(1)
  }

  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections))
    process.exit(1)
  }

  const flags = parseFlags(args)
  const multiFlags = parseFlagsMulti(args)
  const fileFlags = multiFlags.file || []

  // --data is required unless only --file flags are provided
  if (!flags.data && fileFlags.length === 0) {
    console.error('Error: --data flag is required (or use --file to attach files).')
    console.error(`Usage: payload-agent update ${slug} ${id} --data '{"title":"Updated Title"}'`)
    console.error(`Hint: Run 'payload-agent describe ${slug}' to see available fields.`)
    process.exit(1)
  }

  let data: Record<string, unknown> = {}
  if (flags.data) {
    data = parseDataFlag(flags.data)
  }

  const locale = flags.locale ? validateLocale(payload, flags.locale) : undefined

  // Check for unknown fields
  const knownFields = getFieldNames(payload, slug)
  if (knownFields.length > 0) {
    for (const key of Object.keys(data)) {
      if (!knownFields.includes(key)) {
        const suggestion = suggestField(key, knownFields)
        if (suggestion) {
          console.error(
            `Warning: Field '${key}' does not exist on '${slug}'. Did you mean '${suggestion}'?`,
          )
        }
      }
    }
  }

  // Process --file flags: upload files and inject IDs into data
  if (fileFlags.length > 0) {
    const parsed = parseFileFlags(fileFlags)
    data = await processFileFlags(payload, slug, data, parsed, opts.dryRun)
  }

  // For upload collections, also support replacing the file itself via --file
  // without a field path (just a bare file path)
  if (isUploadCollection(payload, slug) && fileFlags.length === 0) {
    // No special handling needed -- standard update without file replacement
  }

  if (opts.dryRun) {
    const target = locale
      ? `document '${id}' in '${slug}' (locale: ${locale})`
      : `document '${id}' in '${slug}'`
    info(`Dry run: would update ${target} with data:`)
    output(data, opts)
    return
  }

  try {
    const result = await payload.update({
      collection: slug as Parameters<typeof payload.update>[0]['collection'],
      id,
      data: data as Record<string, unknown>,
      ...(locale ? { locale } : {}),
      context: { disableRevalidate: true },
    })

    if (opts.json) {
      output(result, opts)
    } else {
      const msg = locale
        ? `Updated document '${id}' in '${slug}' (locale: ${locale}).`
        : `Updated document '${id}' in '${slug}'.`
      console.log(msg)
      output(result, opts)
    }
  } catch (error) {
    console.error(formatValidationError(error, slug, knownFields))
    process.exit(1)
  }
}

/**
 * payload-agent update-many <collection> --where '{...}' --data '{...}' [--locale <code>] [--dry-run]
 */
export async function updateManyCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean },
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]
  if (!slug) {
    console.error(
      "Usage: payload-agent update-many <collection> --where '{...}' --data '{...}' [--locale <code>] [--dry-run]",
    )
    process.exit(1)
  }

  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections))
    process.exit(1)
  }

  const flags = parseFlags(args)

  if (!flags.where) {
    console.error('Error: --where flag is required for update-many.')
    console.error('This prevents accidentally updating all documents.')
    process.exit(1)
  }

  if (!flags.data) {
    console.error('Error: --data flag is required.')
    process.exit(1)
  }

  let where: Where
  try {
    where = JSON.parse(flags.where) as Where
  } catch {
    console.error('Error: Invalid JSON in --where flag.')
    process.exit(1)
    return
  }

  const data = parseDataFlag(flags.data)
  const locale = flags.locale ? validateLocale(payload, flags.locale) : undefined

  if (opts.dryRun) {
    // Preview: find matching docs first
    const preview = await payload.find({
      collection: slug as Parameters<typeof payload.find>[0]['collection'],
      where,
      limit: 10,
      ...buildLocaleArgs(payload, flags),
    })
    const target = locale ? `(locale: ${locale})` : ''
    info(`Dry run: would update ${preview.totalDocs} document(s) in '${slug}' ${target} with data:`)
    output(data, opts)
    if (preview.totalDocs > 0) {
      info('\nFirst 10 affected documents:')
      output(preview.docs, opts)
    }
    return
  }

  try {
    const result = await payload.update({
      collection: slug as Parameters<typeof payload.update>[0]['collection'],
      where,
      data: data as Record<string, unknown>,
      ...(locale ? { locale } : {}),
      context: { disableRevalidate: true },
    })

    const docs = 'docs' in result ? (result as { docs: unknown[] }).docs : [result]

    if (opts.json) {
      output(result, opts)
    } else {
      const msg = locale
        ? `Updated ${docs.length} document(s) in '${slug}' (locale: ${locale}).`
        : `Updated ${docs.length} document(s) in '${slug}'.`
      console.log(msg)
    }
  } catch (error) {
    console.error(formatValidationError(error, slug))
    process.exit(1)
  }
}
