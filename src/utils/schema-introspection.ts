import type { CollectionConfig, Field, GlobalConfig, Payload } from 'payload'

import { formatCollectionNotFoundError, formatGlobalNotFoundError } from '../output/errors.js'

export interface FieldInfo {
  description?: string
  fields?: FieldInfo[]
  hasDefault: boolean
  label?: string
  localized: boolean
  max?: number
  maxDepth?: number
  maxRows?: number
  min?: number
  minRows?: number
  name: string
  options?: Array<{ label: string; value: string }> | string[]
  relationTo?: string | string[]
  required: boolean
  type: string
}

/**
 * Extract field information from a Payload field config.
 * Handles nested fields, arrays, blocks, tabs, etc.
 */
export function extractFieldInfo(field: Field): FieldInfo | null {
  // Skip UI-only fields
  if (field.type === 'ui') {
    return null
  }

  // Handle presentational fields that contain sub-fields
  if (field.type === 'row' || field.type === 'collapsible') {
    // These are layout wrappers - extract their children instead
    return null
  }

  if (field.type === 'tabs') {
    // Tabs contain sub-fields - we flatten them
    return null
  }

  const info: FieldInfo = {
    name: 'name' in field ? (field.name as string) : '(unnamed)',
    type: field.type,
    required: 'required' in field ? Boolean(field.required) : false,
    localized: 'localized' in field ? Boolean(field.localized) : false,
    hasDefault: 'defaultValue' in field && field.defaultValue !== undefined,
  }

  if ('label' in field && field.label && typeof field.label === 'string') {
    info.label = field.label
  }

  if ('admin' in field && field.admin && typeof field.admin === 'object') {
    const admin = field.admin as { description?: string }
    if (admin.description && typeof admin.description === 'string') {
      info.description = admin.description
    }
  }

  // Type-specific info
  switch (field.type) {
    case 'relationship':
    case 'upload':
      if ('relationTo' in field) {
        info.relationTo = field.relationTo
      }
      if ('maxDepth' in field) {
        info.maxDepth = field.maxDepth as number
      }
      break

    case 'select':
    case 'radio':
      if ('options' in field && field.options) {
        info.options = field.options as Array<{ label: string; value: string }> | string[]
      }
      break

    case 'number':
      if ('min' in field) {
        info.min = field.min as number
      }
      if ('max' in field) {
        info.max = field.max as number
      }
      break

    case 'array':
      if ('fields' in field && field.fields) {
        info.fields = extractFieldsInfo(field.fields as Field[])
      }
      if ('minRows' in field) {
        info.minRows = field.minRows as number
      }
      if ('maxRows' in field) {
        info.maxRows = field.maxRows as number
      }
      break

    case 'blocks':
      if ('blocks' in field && field.blocks) {
        info.fields = (field.blocks as Array<{ slug: string; fields: Field[] }>).map((block) => ({
          name: block.slug,
          type: 'block',
          required: false,
          localized: false,
          hasDefault: false,
          fields: extractFieldsInfo(block.fields),
        }))
      }
      break

    case 'group':
      if ('fields' in field && field.fields) {
        info.fields = extractFieldsInfo(field.fields as Field[])
      }
      break
  }

  return info
}

/**
 * Extract info from an array of fields, flattening layout wrappers.
 */
export function extractFieldsInfo(fields: Field[]): FieldInfo[] {
  const result: FieldInfo[] = []

  for (const field of fields) {
    // Flatten layout wrappers
    if (field.type === 'row' || field.type === 'collapsible') {
      if ('fields' in field && field.fields) {
        result.push(...extractFieldsInfo(field.fields as Field[]))
      }
      continue
    }

    if (field.type === 'tabs') {
      if ('tabs' in field && field.tabs) {
        for (const tab of field.tabs as Array<{ fields: Field[] }>) {
          if (tab.fields) {
            result.push(...extractFieldsInfo(tab.fields))
          }
        }
      }
      continue
    }

    const info = extractFieldInfo(field)
    if (info) {
      result.push(info)
    }
  }

  return result
}

/**
 * Get the list of top-level field names for a collection.
 */
export function getFieldNames(payload: Payload, collectionSlug: string): string[] {
  const collection = payload.config.collections.find(
    (c: CollectionConfig) => c.slug === collectionSlug,
  )
  if (!collection) {
    return []
  }
  return extractFieldsInfo(collection.fields as Field[]).map((f) => f.name)
}

/**
 * Get collection slugs.
 */
export function getCollectionSlugs(payload: Payload): string[] {
  return payload.config.collections.map((c: CollectionConfig) => c.slug)
}

/**
 * Get global slugs.
 */
export function getGlobalSlugs(payload: Payload): string[] {
  return (payload.config.globals || []).map((g: GlobalConfig) => g.slug)
}

/**
 * Validate that a collection exists. Returns the slug or throws.
 */
export function validateCollection(payload: Payload, slug: string): string {
  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    throw new Error(formatCollectionNotFoundError(slug, collections))
  }
  return slug
}

/**
 * Validate that a global exists.
 */
export function validateGlobal(payload: Payload, slug: string): string {
  const globals = getGlobalSlugs(payload)
  if (!globals.includes(slug)) {
    throw new Error(formatGlobalNotFoundError(slug, globals))
  }
  return slug
}

/**
 * Check if a collection is upload-enabled.
 */
export function isUploadCollection(payload: Payload, slug: string): boolean {
  const collection = payload.config.collections.find((c: CollectionConfig) => c.slug === slug)
  if (!collection) {
    return false
  }
  return Boolean(collection.upload)
}

/**
 * Get all upload-enabled collection slugs.
 */
export function getUploadCollectionSlugs(payload: Payload): string[] {
  return payload.config.collections
    .filter((c: CollectionConfig) => Boolean(c.upload))
    .map((c: CollectionConfig) => c.slug)
}

/**
 * Resolve a dot-path (e.g. "heroImage", "layout.0.image") to its FieldInfo
 * within a collection's schema.
 *
 * Handles traversal through:
 *   - group fields (group.fieldName)
 *   - array fields (arrayField.0.fieldName -- numeric segments are skipped)
 *   - block fields (blockField.0.fieldName -- numeric segments skipped,
 *     searches across all block types)
 *
 * Returns null if the field cannot be found.
 */
export function resolveFieldPath(
  payload: Payload,
  collectionSlug: string,
  fieldPath: string,
): FieldInfo | null {
  const collection = payload.config.collections.find(
    (c: CollectionConfig) => c.slug === collectionSlug,
  )
  if (!collection) {
    return null
  }

  const segments = fieldPath.split('.')
  let fields = extractFieldsInfo(collection.fields as Field[])

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]

    // Skip numeric segments (array indices)
    if (/^\d+$/.test(segment)) {
      continue
    }

    const field = fields.find((f) => f.name === segment)
    if (!field) {
      return null
    }

    // If this is the last meaningful segment, return it
    const remainingSegments = segments.slice(i + 1).filter((s) => !/^\d+$/.test(s))
    if (remainingSegments.length === 0) {
      return field
    }

    // Traverse into sub-fields
    if (field.fields && field.fields.length > 0) {
      if (field.type === 'blocks') {
        // For blocks, search across all block types' fields
        const allBlockFields: FieldInfo[] = []
        for (const block of field.fields) {
          if (block.fields) {
            allBlockFields.push(...block.fields)
          }
        }
        fields = allBlockFields
      } else {
        // group, array -- descend into sub-fields
        fields = field.fields
      }
    } else {
      // Can't descend further but still have segments
      return null
    }
  }

  return null
}

/**
 * Given a field path that points to an upload/relationship field,
 * determine which upload collection it targets.
 *
 * Returns the upload collection slug, or null if:
 *   - The field doesn't exist
 *   - The field is not an upload/relationship type
 *   - The field's relationTo targets multiple collections (ambiguous)
 *   - The target collection is not upload-enabled
 */
export function resolveUploadCollection(
  payload: Payload,
  collectionSlug: string,
  fieldPath: string,
): { collection: string } | { error: string } {
  const field = resolveFieldPath(payload, collectionSlug, fieldPath)

  if (!field) {
    return {
      error: `Field '${fieldPath}' not found in collection '${collectionSlug}'.`,
    }
  }

  if (field.type !== 'upload' && field.type !== 'relationship') {
    return {
      error: `Field '${fieldPath}' is of type '${field.type}', not an upload or relationship field.`,
    }
  }

  if (!field.relationTo) {
    return { error: `Field '${fieldPath}' has no relationTo defined.` }
  }

  if (Array.isArray(field.relationTo)) {
    // Multiple possible collections -- try to find the one that's upload-enabled
    const uploadTargets = field.relationTo.filter((slug) => isUploadCollection(payload, slug))

    if (uploadTargets.length === 0) {
      return {
        error: `Field '${fieldPath}' relates to [${field.relationTo.join(', ')}], but none are upload-enabled collections.`,
      }
    }
    if (uploadTargets.length === 1) {
      return { collection: uploadTargets[0] }
    }
    return {
      error: `Field '${fieldPath}' relates to multiple upload collections: [${uploadTargets.join(', ')}]. Ambiguous target -- upload the file separately and pass the ID in --data.`,
    }
  }

  // Single relationTo
  if (!isUploadCollection(payload, field.relationTo)) {
    return {
      error: `Field '${fieldPath}' relates to '${field.relationTo}', which is not an upload-enabled collection.`,
    }
  }

  return { collection: field.relationTo }
}

/**
 * Collect dot-paths to all `json` type fields within a FieldInfo tree.
 * Used by --examples to know which fields to extract from sample documents.
 */
export function collectJsonFieldPaths(fields: FieldInfo[], prefix = ''): string[] {
  const paths: string[] = []
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name
    if (field.type === 'json') {
      paths.push(path)
    }
    if (field.fields) {
      if (field.type === 'block') {
        // For blocks, fields are nested inside the block content
        paths.push(...collectJsonFieldPaths(field.fields, path))
      } else {
        paths.push(...collectJsonFieldPaths(field.fields, path))
      }
    }
  }
  return paths
}

/**
 * Summarize a JSON value's structure for display.
 * Produces a compact shape description like:
 *   { headers: string[], rows: string[][] }
 *
 * For arrays, inspects the first element to determine element shape.
 * Truncates long string values but shows the structure clearly.
 */
export function summarizeJsonStructure(value: unknown, maxDepth = 4, depth = 0): string {
  if (depth >= maxDepth) {
    return '...'
  }

  if (value === null || value === undefined) {
    return String(value)
  }
  if (typeof value === 'string') {
    if (value.length > 30) {
      return `"${value.slice(0, 27)}..."`
    }
    return `"${value}"`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]'
    }
    const first = summarizeJsonStructure(value[0], maxDepth, depth + 1)
    const countHint = value.length > 1 ? `  // ${value.length} items` : ''
    return `[${first}, ...]${countHint}`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return '{}'
    }
    const parts = entries.map(([k, v]) => `${k}: ${summarizeJsonStructure(v, maxDepth, depth + 1)}`)
    const oneLine = `{ ${parts.join(', ')} }`
    if (oneLine.length <= 120) {
      return oneLine
    }
    return `{\n${parts.map((p) => `${'  '.repeat(depth + 1)}${p}`).join(',\n')}\n${'  '.repeat(depth)}}`
  }

  return String(value)
}

/**
 * Extract a nested value from an object using a dot-path.
 * Handles arrays by picking the first element.
 * e.g. "sizeTable.data" from { sizeTable: { data: {...} } }
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.')
  let current: unknown = obj

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (Array.isArray(current)) {
      // Pick first element of array
      current = current[0]
      if (current === null || current === undefined) {
        return undefined
      }
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Format a FieldInfo into a human-readable description line.
 */
export function formatFieldLine(
  field: FieldInfo,
  indent = 0,
  jsonExamples?: Map<string, unknown>,
  fieldPath?: string,
): string[] {
  const lines: string[] = []
  const pad = ' '.repeat(indent)
  const flags: string[] = []

  if (field.required) {
    flags.push('required')
  }
  if (field.localized) {
    flags.push('localized')
  }
  if (field.hasDefault) {
    flags.push('has default')
  }

  let typeSuffix = ''
  if (field.relationTo) {
    const rel = Array.isArray(field.relationTo) ? field.relationTo.join(' | ') : field.relationTo
    typeSuffix = ` -> ${rel}`
  }
  if (field.options) {
    const opts = field.options.map((o) => (typeof o === 'string' ? o : o.value)).slice(0, 10)
    typeSuffix = ` [${opts.join(', ')}${field.options.length > 10 ? ', ...' : ''}]`
  }

  const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : ''
  const descStr = field.description ? `  -- ${field.description}` : ''
  const labelStr = field.label && field.label !== field.name ? ` "${field.label}"` : ''

  lines.push(`${pad}${field.name}: ${field.type}${typeSuffix}${flagStr}${labelStr}${descStr}`)

  // Show example for json fields when --examples data is available
  const currentPath = fieldPath ? `${fieldPath}.${field.name}` : field.name
  if (field.type === 'json' && jsonExamples) {
    const example = jsonExamples.get(currentPath)
    if (example !== undefined && example !== null) {
      const summary = summarizeJsonStructure(example)
      const examplePad = ' '.repeat(indent + 2)
      lines.push(`${examplePad}Example: ${summary}`)
    }
  }

  // Recurse into sub-fields
  if (field.fields && field.fields.length > 0) {
    for (const sub of field.fields) {
      lines.push(...formatFieldLine(sub, indent + 2, jsonExamples, currentPath))
    }
  }

  return lines
}
