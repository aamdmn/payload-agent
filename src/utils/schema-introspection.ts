import type { CollectionConfig, Field, GlobalConfig, Payload } from 'payload'

import { formatCollectionNotFoundError, formatGlobalNotFoundError } from '../output/errors.js'

export interface FieldInfo {
  name: string
  type: string
  required: boolean
  localized: boolean
  hasDefault: boolean
  label?: string
  description?: string
  relationTo?: string | string[]
  options?: Array<{ label: string; value: string }> | string[]
  fields?: FieldInfo[]
  maxDepth?: number
  min?: number
  max?: number
  minRows?: number
  maxRows?: number
}

/**
 * Extract field information from a Payload field config.
 * Handles nested fields, arrays, blocks, tabs, etc.
 */
export function extractFieldInfo(field: Field): FieldInfo | null {
  // Skip UI-only fields
  if (field.type === 'ui') return null

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
      if ('min' in field) info.min = field.min as number
      if ('max' in field) info.max = field.max as number
      break

    case 'array':
      if ('fields' in field && field.fields) {
        info.fields = extractFieldsInfo(field.fields as Field[])
      }
      if ('minRows' in field) info.minRows = field.minRows as number
      if ('maxRows' in field) info.maxRows = field.maxRows as number
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
  if (!collection) return []
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
 * Format a FieldInfo into a human-readable description line.
 */
export function formatFieldLine(field: FieldInfo, indent = 0): string[] {
  const lines: string[] = []
  const pad = ' '.repeat(indent)
  const flags: string[] = []

  if (field.required) flags.push('required')
  if (field.localized) flags.push('localized')
  if (field.hasDefault) flags.push('has default')

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

  // Recurse into sub-fields
  if (field.fields && field.fields.length > 0) {
    for (const sub of field.fields) {
      lines.push(...formatFieldLine(sub, indent + 2))
    }
  }

  return lines
}
