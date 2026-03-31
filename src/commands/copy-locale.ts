import type { Field, Payload, Where } from 'payload'
import {
  formatCollectionNotFoundError,
  formatGlobalNotFoundError,
  formatValidationError,
} from '../output/errors.js'
import type { OutputOptions } from '../output/formatter.js'
import { info } from '../output/formatter.js'
import { validateLocale } from '../utils/locale.js'
import { parseFlags, positionalArgs } from '../utils/parse-flags.js'
import {
  extractFieldsInfo,
  type FieldInfo,
  getCollectionSlugs,
  getGlobalSlugs,
} from '../utils/schema-introspection.js'

/**
 * Recursively strip all `id` fields from a data object.
 * Payload rejects `id` fields in the data payload during locale-scoped updates
 * (the document id is passed separately, and nested item IDs cause validation errors).
 */
function stripIds(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(stripIds)
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === 'id') {
        continue
      }
      result[k] = stripIds(v)
    }
    return result
  }
  return obj
}

/**
 * Recursively collect all localized field names from a FieldInfo tree.
 * Returns a flat list of dot-path names for display purposes.
 */
function collectLocalizedFieldNames(fieldInfos: FieldInfo[], prefix = ''): string[] {
  const names: string[] = []
  for (const field of fieldInfos) {
    const path = prefix ? `${prefix}.${field.name}` : field.name
    if (field.localized) {
      names.push(path)
    }
    if (field.fields && field.fields.length > 0) {
      names.push(...collectLocalizedFieldNames(field.fields, path))
    }
  }
  return names
}

/**
 * Check if any field in the tree (at any depth) is localized.
 */
function hasAnyLocalizedField(fieldInfos: FieldInfo[]): boolean {
  for (const field of fieldInfos) {
    if (field.localized) {
      return true
    }
    if (field.fields && hasAnyLocalizedField(field.fields)) {
      return true
    }
  }
  return false
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
  opts: Partial<OutputOptions> & { dryRun?: boolean },
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]
  const singleId = pos[1] // optional

  if (!slug) {
    console.error(
      "Usage: payload-agent copy-locale <collection> [<id>] --from <locale> --to <locale> [--where '{...}'] [--dry-run]",
    )
    process.exit(1)
  }

  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections))
    process.exit(1)
  }

  const flags = parseFlags(args)

  if (!(flags.from && flags.to)) {
    console.error('Error: --from and --to flags are required.')
    console.error('Example: payload-agent copy-locale products --from sk --to cz')
    process.exit(1)
  }

  const fromLocale = validateLocale(payload, flags.from)
  const toLocale = validateLocale(payload, flags.to)

  if (fromLocale === toLocale) {
    console.error(`Error: --from and --to cannot be the same locale ("${fromLocale}").`)
    process.exit(1)
  }

  if (fromLocale === 'all' || toLocale === 'all') {
    console.error('Error: "all" is not valid for copy-locale. Use specific locale codes.')
    process.exit(1)
  }

  // Get schema to identify localized fields
  const collection = payload.config.collections.find((c) => c.slug === slug)
  if (!collection) {
    console.error(`Error: Collection '${slug}' not found.`)
    process.exit(1)
    return
  }
  const fieldInfos = extractFieldsInfo(collection.fields as Field[])

  if (!hasAnyLocalizedField(fieldInfos)) {
    console.log(`No localized fields found in '${slug}'. Nothing to copy.`)
    return
  }

  const localizedFieldNames = collectLocalizedFieldNames(fieldInfos)
  info(`Localized fields: ${localizedFieldNames.join(', ')}`)

  // Determine which documents to process
  let where: Where | undefined
  if (singleId) {
    // Single document mode
    where = { id: { equals: singleId } }
  } else if (flags.where) {
    try {
      where = JSON.parse(flags.where) as Where
    } catch {
      console.error('Error: Invalid JSON in --where flag.')
      process.exit(1)
      return
    }
  }

  // Fetch all matching documents
  let allDocs: Array<Record<string, unknown>> = []
  let page = 1
  const limit = 100

  while (true) {
    const result = await payload.find({
      collection: slug as Parameters<typeof payload.find>[0]['collection'],
      locale: fromLocale,
      depth: 0,
      limit,
      page,
      ...(where ? { where } : {}),
    })

    allDocs = allDocs.concat(result.docs as Array<Record<string, unknown>>)

    if (!result.hasNextPage) {
      break
    }
    page++
  }

  if (allDocs.length === 0) {
    console.log('No documents found matching the criteria.')
    return
  }

  info(`Found ${allDocs.length} document(s) to copy locale ${fromLocale} → ${toLocale}.`)

  if (opts.dryRun) {
    info(
      `\nDry run: would copy ${allDocs.length} document(s) from locale ${fromLocale} to ${toLocale}.`,
    )
    info("Payload's locale-scoped update will only write localized field columns.")
    return
  }

  let copied = 0
  let errors = 0

  // Only include writable fields from the schema.
  // Excludes system fields (id, timestamps) and virtual fields (join).
  const READ_ONLY_TYPES = new Set(['join'])
  const knownFieldNames = new Set(
    fieldInfos.filter((f) => !READ_ONLY_TYPES.has(f.type)).map((f) => f.name),
  )

  for (const doc of allDocs) {
    // Pass known fields only — Payload's locale-scoped update
    // only writes to localized field columns, ignoring non-localized fields.
    // Keep nested id fields (for matching array/block items) but strip top-level id.
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(doc)) {
      if (knownFieldNames.has(key)) {
        data[key] = value
      }
    }

    if (Object.keys(data).length === 0) {
      continue
    }

    try {
      await payload.update({
        collection: slug as Parameters<typeof payload.update>[0]['collection'],
        id: doc.id as string,
        locale: toLocale,
        data,
        context: { disableRevalidate: true },
      })
      copied++
    } catch (error) {
      errors++
      console.error(
        `Error copying locale for document '${doc.id}': ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (copied % 25 === 0 && copied > 0) {
      info(`  Copied ${copied}/${allDocs.length}...`)
    }
  }

  console.log(
    `Copied locale ${fromLocale} → ${toLocale} for ${copied} document(s) in '${slug}'.${errors > 0 ? ` (${errors} error(s))` : ''}`,
  )
}

/**
 * payload-agent copy-locale-global <slug> --from <locale> --to <locale> [--dry-run]
 *
 * Copies all localized field values from one locale to another for a global.
 */
export async function copyLocaleGlobalCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean },
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]

  if (!slug) {
    console.error(
      'Usage: payload-agent copy-locale-global <slug> --from <locale> --to <locale> [--dry-run]',
    )
    process.exit(1)
  }

  const globals = getGlobalSlugs(payload)
  if (!globals.includes(slug)) {
    console.error(formatGlobalNotFoundError(slug, globals))
    process.exit(1)
  }

  const flags = parseFlags(args)

  if (!(flags.from && flags.to)) {
    console.error('Error: --from and --to flags are required.')
    console.error('Example: payload-agent copy-locale-global header --from sk --to cz')
    process.exit(1)
  }

  const fromLocale = validateLocale(payload, flags.from)
  const toLocale = validateLocale(payload, flags.to)

  if (fromLocale === toLocale) {
    console.error(`Error: --from and --to cannot be the same locale ("${fromLocale}").`)
    process.exit(1)
  }

  if (fromLocale === 'all' || toLocale === 'all') {
    console.error('Error: "all" is not valid for copy-locale-global. Use specific locale codes.')
    process.exit(1)
  }

  // Get schema
  const global = payload.config.globals?.find((g) => g.slug === slug)
  if (!global) {
    console.error(`Error: Global '${slug}' not found.`)
    process.exit(1)
    return
  }
  const fieldInfos = extractFieldsInfo(global.fields as Field[])

  if (!hasAnyLocalizedField(fieldInfos)) {
    console.log(`No localized fields found in global '${slug}'. Nothing to copy.`)
    return
  }

  const localizedFieldNames = collectLocalizedFieldNames(fieldInfos)

  info(`Localized fields: ${localizedFieldNames.join(', ')}`)

  // Read the global with source locale
  const doc = await payload.findGlobal({
    slug: slug as Parameters<typeof payload.findGlobal>[0]['slug'],
    locale: fromLocale,
    depth: 0,
  })

  // Only include fields from the schema (with all id fields stripped)
  const knownFieldNames = new Set(fieldInfos.map((f) => f.name))
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (knownFieldNames.has(key)) {
      data[key] = stripIds(value)
    }
  }

  if (Object.keys(data).length === 0) {
    console.log('No field values found to copy.')
    return
  }

  if (opts.dryRun) {
    info(
      `Dry run: would copy localized fields from ${fromLocale} → ${toLocale} for global '${slug}'.`,
    )
    info("Payload's locale-scoped update will only write localized field columns.")
    return
  }

  try {
    await payload.updateGlobal({
      slug: slug as Parameters<typeof payload.updateGlobal>[0]['slug'],
      locale: toLocale,
      data: data as Record<string, unknown>,
      context: { disableRevalidate: true },
    })

    console.log(`Copied locale ${fromLocale} → ${toLocale} for global '${slug}'.`)
  } catch (error) {
    console.error(formatValidationError(error))
    process.exit(1)
  }
}
