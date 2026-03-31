/**
 * ESM resolve hook for tsconfig.json path aliases.
 *
 * Registered via module.register() at runtime. Receives the tsconfig
 * paths mapping and baseUrl via the initialization data channel.
 *
 * This allows payload-agent to load user payload.config.ts files that
 * use TypeScript path aliases like `@/*`.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

interface PathMapping {
  prefix: string
  suffix: string
  targets: string[]
}

const pathMappings: PathMapping[] = []
let baseDir = ''

/**
 * Called once when the hook is initialized via module.register().
 * Receives the tsconfig paths configuration.
 */
export function initialize(data: { paths: Record<string, string[]>; baseUrl: string }) {
  baseDir = data.baseUrl

  // Convert tsconfig paths into prefix/suffix patterns
  // e.g. { "@/*": ["./src/*"] } -> { prefix: "@/", suffix: "", targets: ["./src/"] }
  for (const [pattern, targets] of Object.entries(data.paths)) {
    const starIndex = pattern.indexOf('*')
    if (starIndex === -1) {
      // Exact match (no wildcard)
      pathMappings.push({
        prefix: pattern,
        suffix: '',
        targets: targets.map((t) => path.resolve(baseDir, t)),
      })
    } else {
      // Wildcard match
      pathMappings.push({
        prefix: pattern.slice(0, starIndex),
        suffix: pattern.slice(starIndex + 1),
        targets: targets.map((t) => {
          const tStarIndex = t.indexOf('*')
          if (tStarIndex === -1) return path.resolve(baseDir, t)
          // Return the target pattern prefix and suffix for later substitution
          return t
        }),
      })
    }
  }
}

/**
 * ESM resolve hook. Intercepts module resolution to handle tsconfig path aliases.
 */
export async function resolve(
  specifier: string,
  context: { parentURL?: string; conditions?: string[] },
  nextResolve: (
    specifier: string,
    context: { parentURL?: string; conditions?: string[] },
  ) => Promise<{ url: string; shortCircuit?: boolean }>,
): Promise<{ url: string; shortCircuit?: boolean }> {
  // Only process bare specifiers (not relative, absolute, or URL paths)
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('file://') ||
    specifier.startsWith('node:') ||
    specifier.startsWith('data:')
  ) {
    return nextResolve(specifier, context)
  }

  for (const mapping of pathMappings) {
    if (!specifier.startsWith(mapping.prefix)) continue
    if (mapping.suffix && !specifier.endsWith(mapping.suffix)) continue

    // Extract the wildcard match portion
    const matchedPart = specifier.slice(
      mapping.prefix.length,
      mapping.suffix ? specifier.length - mapping.suffix.length : undefined,
    )

    for (const target of mapping.targets) {
      let resolvedPath: string
      const starIndex = target.indexOf('*')
      if (starIndex !== -1) {
        // Replace * in target with the matched portion
        const targetPath = target.slice(0, starIndex) + matchedPart + target.slice(starIndex + 1)
        resolvedPath = path.resolve(baseDir, targetPath)
      } else {
        resolvedPath = target
      }

      // Try to resolve the path with common extensions
      const candidates = [
        resolvedPath,
        `${resolvedPath}.ts`,
        `${resolvedPath}.tsx`,
        `${resolvedPath}.js`,
        `${resolvedPath}.jsx`,
        `${resolvedPath}/index.ts`,
        `${resolvedPath}/index.tsx`,
        `${resolvedPath}/index.js`,
        `${resolvedPath}/index.jsx`,
      ]

      for (const candidate of candidates) {
        try {
          // Check if file exists by trying to resolve it
          const url = pathToFileURL(candidate).href
          // Try the next resolver to validate the file exists
          const result = await nextResolve(url, context)
          return result
        } catch {
          // Try next candidate
        }
      }
    }
  }

  // No mapping matched, fall through to default resolution
  return nextResolve(specifier, context)
}
