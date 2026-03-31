import type { CollectionConfig, Field, GlobalConfig, Payload } from 'payload'
import { formatCollectionNotFoundError } from '../output/errors.js'
import type { OutputOptions } from '../output/formatter.js'
import { output } from '../output/formatter.js'
import { formatLocales, getLocaleConfig } from '../utils/locale.js'
import {
  extractFieldsInfo,
  formatFieldLine,
  getCollectionSlugs,
  getGlobalSlugs,
} from '../utils/schema-introspection.js'

/**
 * payload-agent describe <collection|global> - Show full schema details.
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

  // Check if it's a collection
  const collections = getCollectionSlugs(payload)
  const globals = getGlobalSlugs(payload)

  if (collections.includes(slug)) {
    describeCollection(payload, slug, opts)
    return
  }

  if (globals.includes(slug)) {
    describeGlobal(payload, slug, opts)
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

function describeCollection(payload: Payload, slug: string, opts: Partial<OutputOptions>): void {
  const collection = payload.config.collections.find((c: CollectionConfig) => c.slug === slug)!

  const allFields = extractFieldsInfo(collection.fields as Field[])

  // Filter out system fields that Payload auto-injects (we show them separately)
  const systemFieldNames = new Set(['id', 'createdAt', 'updatedAt'])
  const fields = allFields.filter((f) => !systemFieldNames.has(f.name))

  if (opts.json) {
    output(
      {
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
      },
      opts,
    )
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
    lines.push(...formatFieldLine(field, 2))
  }

  console.log(lines.join('\n'))
}

function describeGlobal(payload: Payload, slug: string, opts: Partial<OutputOptions>): void {
  const global = payload.config.globals.find((g: GlobalConfig) => g.slug === slug)!

  const fields = extractFieldsInfo(global.fields as Field[])

  if (opts.json) {
    output(
      {
        type: 'global',
        slug: global.slug,
        label: typeof global.label === 'string' ? global.label : global.slug,
        fields,
      },
      opts,
    )
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
    lines.push(...formatFieldLine(field, 2))
  }

  console.log(lines.join('\n'))
}
