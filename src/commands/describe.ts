import type { CollectionConfig, Field, GlobalConfig, Payload } from 'payload'
import { formatCollectionNotFoundError } from '../output/errors.js'
import type { OutputOptions } from '../output/formatter.js'
import { output } from '../output/formatter.js'
import { formatLocales, getLocaleConfig } from '../utils/locale.js'
import { parseFlags } from '../utils/parse-flags.js'
import {
  collectJsonFieldPaths,
  extractFieldsInfo,
  formatFieldLine,
  getCollectionSlugs,
  getGlobalSlugs,
  getNestedValue,
  summarizeJsonStructure,
} from '../utils/schema-introspection.js'

/**
 * payload-agent describe <collection|global> - Show full schema details.
 *
 * Supports --examples flag: samples an existing document to show
 * the expected structure of `json` fields (e.g. custom editors).
 */
export async function describeCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions>,
): Promise<void> {
  const slug = args[0]
  if (!slug) {
    console.error('Usage: payload-agent describe <collection-or-global>')
    console.error(
      "Hint: Run 'payload-agent collections' or 'payload-agent globals' to see available slugs.",
    )
    process.exit(1)
  }

  const flags = parseFlags(args)
  const withExamples = flags.examples === 'true'

  // Check if it's a collection
  const collections = getCollectionSlugs(payload)
  const globals = getGlobalSlugs(payload)

  if (collections.includes(slug)) {
    await describeCollection(payload, slug, opts, withExamples)
    return
  }

  if (globals.includes(slug)) {
    await describeGlobal(payload, slug, opts, withExamples)
    return
  }

  // Not found in either - give a helpful error
  // Try to suggest from both lists
  const _all = [...collections, ...globals]
  const collectionError = formatCollectionNotFoundError(slug, collections)

  if (globals.length > 0) {
    console.error(`Error: '${slug}' is not a collection or global.`)
    console.error('')
    console.error('Collections:', collections.join(', ') || '(none)')
    console.error('Globals:', globals.join(', ') || '(none)')
  } else {
    console.error(collectionError)
  }
  process.exit(1)
}

async function describeCollection(
  payload: Payload,
  slug: string,
  opts: Partial<OutputOptions>,
  withExamples = false,
): Promise<void> {
  const collection = payload.config.collections.find((c: CollectionConfig) => c.slug === slug)!

  const allFields = extractFieldsInfo(collection.fields as Field[])

  // Filter out system fields that Payload auto-injects (we show them separately)
  const systemFieldNames = new Set(['id', 'createdAt', 'updatedAt'])
  const fields = allFields.filter((f) => !systemFieldNames.has(f.name))

  // If --examples, sample a document and extract json field values
  let jsonExamples: Map<string, unknown> | undefined
  if (withExamples) {
    jsonExamples = await sampleJsonFields(payload, slug, fields)
  }

  if (opts.json) {
    const result: Record<string, unknown> = {
      type: 'collection',
      slug: collection.slug,
      label:
        typeof collection.labels?.singular === 'string'
          ? collection.labels.singular
          : collection.slug,
      auth: Boolean(collection.auth),
      upload: Boolean(collection.upload),
      timestamps: collection.timestamps !== false,
      fields,
    }

    if (jsonExamples && jsonExamples.size > 0) {
      const examples: Record<string, unknown> = {}
      for (const [path, value] of jsonExamples) {
        examples[path] = {
          path,
          structure: summarizeJsonStructure(value),
          value,
        }
      }
      result.jsonExamples = examples
    }

    output(result, opts)
    return
  }

  // Human-readable output
  const lines: string[] = []
  lines.push(`Collection: ${slug}`)

  const meta: string[] = []
  if (collection.auth) {
    meta.push('auth')
  }
  if (collection.upload) {
    meta.push('upload')
  }
  if (collection.timestamps !== false) {
    meta.push('timestamps')
  }
  if (meta.length > 0) {
    lines.push(`Flags: ${meta.join(', ')}`)
  }

  const localeConfig = getLocaleConfig(payload)
  if (localeConfig) {
    lines.push(`Locales: ${formatLocales(localeConfig)}`)
  }

  lines.push('')
  lines.push('Fields:')

  // Always-present system fields
  lines.push('  id: text (auto-generated)')
  if (collection.timestamps !== false) {
    lines.push('  createdAt: date (auto-generated)')
    lines.push('  updatedAt: date (auto-generated)')
  }

  for (const field of fields) {
    lines.push(...formatFieldLine(field, 2, jsonExamples))
  }

  if (withExamples && (!jsonExamples || jsonExamples.size === 0)) {
    lines.push('')
    lines.push(
      'Note: No json field examples available (collection is empty or has no json fields).',
    )
  }

  console.log(lines.join('\n'))
}

async function describeGlobal(
  payload: Payload,
  slug: string,
  opts: Partial<OutputOptions>,
  withExamples = false,
): Promise<void> {
  const global = payload.config.globals.find((g: GlobalConfig) => g.slug === slug)!

  const fields = extractFieldsInfo(global.fields as Field[])

  // If --examples, sample the global and extract json field values
  let jsonExamples: Map<string, unknown> | undefined
  if (withExamples) {
    jsonExamples = await sampleGlobalJsonFields(payload, slug, fields)
  }

  if (opts.json) {
    const result: Record<string, unknown> = {
      type: 'global',
      slug: global.slug,
      label: typeof global.label === 'string' ? global.label : global.slug,
      fields,
    }

    if (jsonExamples && jsonExamples.size > 0) {
      const examples: Record<string, unknown> = {}
      for (const [path, value] of jsonExamples) {
        examples[path] = {
          path,
          structure: summarizeJsonStructure(value),
          value,
        }
      }
      result.jsonExamples = examples
    }

    output(result, opts)
    return
  }

  const lines: string[] = []
  lines.push(`Global: ${slug}`)

  const localeConfig = getLocaleConfig(payload)
  if (localeConfig) {
    lines.push(`Locales: ${formatLocales(localeConfig)}`)
  }

  lines.push('')
  lines.push('Fields:')

  for (const field of fields) {
    lines.push(...formatFieldLine(field, 2, jsonExamples))
  }

  if (withExamples && (!jsonExamples || jsonExamples.size === 0)) {
    lines.push('')
    lines.push('Note: No json field examples available (global has no data or no json fields).')
  }

  console.log(lines.join('\n'))
}

/**
 * Sample one document from a collection and extract values for all json fields.
 * Returns a Map of field dot-path -> sample value.
 */
async function sampleJsonFields(
  payload: Payload,
  collectionSlug: string,
  fields: import('../utils/schema-introspection.js').FieldInfo[],
): Promise<Map<string, unknown>> {
  const jsonPaths = collectJsonFieldPaths(fields)
  const examples = new Map<string, unknown>()

  if (jsonPaths.length === 0) {
    return examples
  }

  try {
    // Query one document that has data, sorted by most recent
    const result = await payload.find({
      collection: collectionSlug as any,
      limit: 1,
      sort: '-updatedAt',
      depth: 0,
    })

    if (result.docs.length === 0) {
      return examples
    }

    const doc = result.docs[0] as Record<string, unknown>

    for (const path of jsonPaths) {
      const value = getNestedValue(doc, path)
      if (value !== undefined && value !== null) {
        examples.set(path, value)
      }
    }
  } catch (err) {
    // Best-effort: log hint if verbose
    if (process.env.PAYLOAD_AGENT_VERBOSE) {
      console.error(`[examples] Failed to sample ${collectionSlug}:`, err)
    }
  }

  return examples
}

/**
 * Sample a global document and extract values for all json fields.
 */
async function sampleGlobalJsonFields(
  payload: Payload,
  globalSlug: string,
  fields: import('../utils/schema-introspection.js').FieldInfo[],
): Promise<Map<string, unknown>> {
  const jsonPaths = collectJsonFieldPaths(fields)
  const examples = new Map<string, unknown>()

  if (jsonPaths.length === 0) {
    return examples
  }

  try {
    const doc = (await payload.findGlobal({
      slug: globalSlug as any,
      depth: 0,
    })) as Record<string, unknown>

    for (const path of jsonPaths) {
      const value = getNestedValue(doc, path)
      if (value !== undefined && value !== null) {
        examples.set(path, value)
      }
    }
  } catch (err) {
    // Best-effort: log hint if verbose
    if (process.env.PAYLOAD_AGENT_VERBOSE) {
      console.error(`[examples] Failed to sample global ${globalSlug}:`, err)
    }
  }

  return examples
}
