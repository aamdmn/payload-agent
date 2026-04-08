import fs from 'node:fs'
import path from 'node:path'
import type { Payload } from 'payload'

/**
 * Find the payload-types.ts file in the project.
 *
 * Checks:
 *   1. payload.config.typescript.outputFile (if configured)
 *   2. Common locations relative to CWD
 */
export function findPayloadTypesFile(payload: Payload): string | null {
  const config = payload.config as Record<string, unknown>
  const tsConfig = config.typescript as Record<string, unknown> | undefined

  if (tsConfig?.outputFile && typeof tsConfig.outputFile === 'string') {
    const outputFile = path.resolve(tsConfig.outputFile)
    if (fs.existsSync(outputFile)) {
      return outputFile
    }
  }

  // Common locations
  const candidates = [
    'src/payload-types.ts',
    'payload-types.ts',
    'app/payload-types.ts',
    'src/app/payload-types.ts',
  ]

  for (const candidate of candidates) {
    const fullPath = path.resolve(process.cwd(), candidate)
    if (fs.existsSync(fullPath)) {
      return fullPath
    }
  }

  return null
}

/**
 * Extract a brace-delimited block starting at the given index.
 * The index should point to the opening '{'.
 * Returns the content including both braces.
 */
function extractBraceBlock(content: string, openIndex: number): string | null {
  if (content[openIndex] !== '{') {
    return null
  }

  let depth = 0
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === '{') {
      depth++
    } else if (content[i] === '}') {
      depth--
      if (depth === 0) {
        return content.slice(openIndex, i + 1)
      }
    }
  }

  return null
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Resolve the TypeScript interface name for a collection or global slug
 * by parsing the Config interface in payload-types.ts.
 *
 * Looks for patterns like:
 *   posts: Post;
 *   'block-fields': BlockField;
 */
export function resolveTypeName(
  fileContent: string,
  slug: string,
  kind: 'collection' | 'global',
): string | null {
  const sectionKey = kind === 'collection' ? 'collections' : 'globals'

  // Find the Config interface
  const configMatch = fileContent.match(/export\s+interface\s+Config\s*\{/)
  if (!configMatch?.index) {
    return null
  }

  const configBlock = extractBraceBlock(fileContent, fileContent.indexOf('{', configMatch.index))
  if (!configBlock) {
    return null
  }

  // Find the section (collections: { ... } or globals: { ... })
  const sectionRegex = new RegExp(`${sectionKey}\\s*:\\s*\\{`)
  const sectionMatch = configBlock.match(sectionRegex)
  if (!sectionMatch?.index) {
    return null
  }

  const sectionBraceStart = configBlock.indexOf('{', sectionMatch.index + sectionKey.length)
  const sectionBlock = extractBraceBlock(configBlock, sectionBraceStart)
  if (!sectionBlock) {
    return null
  }

  // Match the slug to its type name
  // Handles: posts: Post;  |  'my-posts': MyPost;  |  "my-posts": MyPost;
  const slugPattern = new RegExp(`['"]?${escapeRegex(slug)}['"]?\\s*:\\s*([A-Z][A-Za-z0-9_]*)\\s*;`)
  const match = sectionBlock.match(slugPattern)
  return match ? match[1] : null
}

/**
 * Extract an `export interface Name { ... }` block from the file.
 * Includes any JSDoc comment directly above it.
 */
export function extractInterface(fileContent: string, typeName: string): string | null {
  const regex = new RegExp(`export\\s+interface\\s+${escapeRegex(typeName)}\\s*(?:<[^>]*>\\s*)?\\{`)
  const match = fileContent.match(regex)
  if (!match?.index && match?.index !== 0) {
    return null
  }

  const startIndex = match.index
  const braceStart = fileContent.indexOf('{', startIndex)
  if (braceStart === -1) {
    return null
  }

  const block = extractBraceBlock(fileContent, braceStart)
  if (!block) {
    return null
  }

  // Look for JSDoc comment directly above the interface.
  // Search backward from startIndex for a `*/` ending, then find its `/**`.
  let prefix = ''
  const lookback = fileContent.slice(Math.max(0, startIndex - 1000), startIndex)
  const trimmed = lookback.trimEnd()
  if (trimmed.endsWith('*/')) {
    const commentStart = trimmed.lastIndexOf('/**')
    if (commentStart !== -1) {
      // Verify there's no code between the comment and the interface
      const between = trimmed.slice(trimmed.indexOf('*/', commentStart) + 2)
      if (between.trim() === '') {
        prefix = `${trimmed.slice(commentStart)}\n`
      }
    }
  }

  return prefix + fileContent.slice(startIndex, braceStart) + block
}

/**
 * Extract the locale union type from Config, if present.
 * Returns something like: 'en' | 'cs' | 'de'
 */
export function extractLocaleType(fileContent: string): string | null {
  const configMatch = fileContent.match(/export\s+interface\s+Config\s*\{/)
  if (!configMatch?.index) {
    return null
  }

  const configBlock = extractBraceBlock(fileContent, fileContent.indexOf('{', configMatch.index))
  if (!configBlock) {
    return null
  }

  // Match:  locale: 'en' | 'es' | 'pt';
  const localeMatch = configBlock.match(/locale\s*:\s*([^;]+);/)
  if (!localeMatch) {
    return null
  }

  return localeMatch[1].trim()
}

/**
 * Find type names referenced in an interface body.
 * Looks for PascalCase identifiers in type positions
 * (excludes built-in types, comments, and string literals).
 */
export function findReferencedTypes(interfaceBody: string): string[] {
  const builtins = new Set([
    'Record',
    'Array',
    'Partial',
    'Required',
    'Pick',
    'Omit',
    'Promise',
    'Date',
    'RegExp',
    'Map',
    'Set',
    'Function',
    'Error',
  ])

  // Strip comments and string literals to avoid false positives
  const cleaned = interfaceBody
    .replace(/\/\*\*[\s\S]*?\*\//g, '') // JSDoc comments
    .replace(/\/\/.*$/gm, '') // line comments
    .replace(/'[^']*'/g, '""') // single-quoted strings
    .replace(/"[^"]*"/g, '""') // double-quoted strings

  const typeRefs = new Set<string>()

  // Match PascalCase identifiers (2+ chars, starts with uppercase)
  const matches = cleaned.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)
  for (const match of matches) {
    const name = match[1]
    if (!builtins.has(name)) {
      typeRefs.add(name)
    }
  }

  return [...typeRefs]
}

export interface TypesResult {
  interface: string
  filePath: string
  locale?: string
  referencedTypes: string[]
}

/**
 * Get the TypeScript interface for a collection or global slug.
 */
export function getTypeInterface(
  payload: Payload,
  slug: string,
  kind: 'collection' | 'global',
): TypesResult | { error: string } {
  const filePath = findPayloadTypesFile(payload)
  if (!filePath) {
    return {
      error: [
        'Could not find payload-types.ts.',
        "Run 'npx payload generate:types' to generate it.",
      ].join('\n'),
    }
  }

  const content = fs.readFileSync(filePath, 'utf-8')

  const typeName = resolveTypeName(content, slug, kind)
  if (!typeName) {
    return {
      error: `Could not find type mapping for '${slug}' in ${path.relative(process.cwd(), filePath)}.`,
    }
  }

  const iface = extractInterface(content, typeName)
  if (!iface) {
    return {
      error: `Found type name '${typeName}' but could not extract its interface from ${path.relative(process.cwd(), filePath)}.`,
    }
  }

  const locale = extractLocaleType(content) || undefined

  // Find referenced types (other interfaces mentioned in the body)
  // Exclude the interface's own name
  const referencedTypes = findReferencedTypes(iface).filter((t) => t !== typeName)

  return {
    interface: iface,
    filePath: path.relative(process.cwd(), filePath),
    locale,
    referencedTypes,
  }
}
