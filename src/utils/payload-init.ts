import fs from 'node:fs'
import module from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Payload, SanitizedConfig } from 'payload'
import { parseTsConfigPaths } from './config-finder.js'

let payloadInstance: Payload | null = null

interface PathMapping {
  prefix: string
  suffix: string
  targets: string[]
}

/**
 * Build path mappings from tsconfig paths configuration.
 */
function buildPathMappings(paths: Record<string, string[]>, baseUrl: string): PathMapping[] {
  const mappings: PathMapping[] = []

  for (const [pattern, targets] of Object.entries(paths)) {
    const starIndex = pattern.indexOf('*')
    if (starIndex === -1) {
      // Exact match (no wildcard)
      mappings.push({
        prefix: pattern,
        suffix: '',
        targets: targets.map((t) => path.resolve(baseUrl, t)),
      })
    } else {
      mappings.push({
        prefix: pattern.slice(0, starIndex),
        suffix: pattern.slice(starIndex + 1),
        targets: targets.map((t) => t),
      })
    }
  }

  return mappings
}

/**
 * Try to resolve a file path with common TypeScript/JavaScript extensions.
 */
function tryResolveWithExtensions(resolvedPath: string): string | null {
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
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * Register tsconfig path aliases using Node.js module hooks.
 * Uses module.registerHooks() (synchronous, in-thread) when available (Node >= 22.15),
 * falls back to module.register() (async, worker thread) for older versions.
 */
function registerPathAliases(tsconfigPath: string): void {
  const pathsConfig = parseTsConfigPaths(tsconfigPath)
  if (!pathsConfig) return

  const mappings = buildPathMappings(pathsConfig.paths, pathsConfig.baseUrl)
  if (mappings.length === 0) return

  const baseDir = pathsConfig.baseUrl

  // Use synchronous registerHooks if available (Node >= 22.15.0)
  if (typeof module.registerHooks === 'function') {
    module.registerHooks({
      resolve(specifier, context, nextResolve) {
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

        for (const mapping of mappings) {
          if (!specifier.startsWith(mapping.prefix)) continue
          if (mapping.suffix && !specifier.endsWith(mapping.suffix)) continue

          // Extract the wildcard match portion
          const matchedPart = specifier.slice(
            mapping.prefix.length,
            mapping.suffix ? specifier.length - mapping.suffix.length : undefined,
          )

          for (const target of mapping.targets) {
            let resolvedFilePath: string
            const starIndex = target.indexOf('*')
            if (starIndex !== -1) {
              const targetPath =
                target.slice(0, starIndex) + matchedPart + target.slice(starIndex + 1)
              resolvedFilePath = path.resolve(baseDir, targetPath)
            } else {
              resolvedFilePath = path.resolve(baseDir, target)
            }

            const resolved = tryResolveWithExtensions(resolvedFilePath)
            if (resolved) {
              return nextResolve(pathToFileURL(resolved).href, context)
            }
          }
        }

        return nextResolve(specifier, context)
      },
    })
    return
  }

  // Fallback: use module.register() with a separate hook file for older Node versions
  const hookUrl = getPathsHookUrl()
  module.register(hookUrl, {
    parentURL: import.meta.url,
    data: pathsConfig,
  })
}

/**
 * Resolve the paths-hook file URL for the module.register() fallback.
 */
function getPathsHookUrl(): string {
  const jsUrl = new URL('./paths-hook.js', import.meta.url)
  if (fs.existsSync(fileURLToPath(jsUrl))) {
    return jsUrl.href
  }
  // Fallback for development (tsx handles .ts files)
  return new URL('./paths-hook.ts', import.meta.url).href
}

/**
 * Initialize Payload using the local API (no HTTP server).
 * Caches the instance for the lifetime of the process.
 */
export async function getPayloadInstance(
  configPath: string,
  tsconfigPath?: string,
): Promise<Payload> {
  if (payloadInstance) {
    return payloadInstance
  }

  // Register tsconfig path aliases before importing the config
  if (tsconfigPath) {
    registerPathAliases(tsconfigPath)
  }

  // Payload expects this env var to find the config
  process.env.PAYLOAD_CONFIG_PATH = configPath

  const { getPayload } = await import('payload')

  // Import the config - handle both default export and promise exports
  const configModule = await import(configPath)
  let config: SanitizedConfig | Promise<SanitizedConfig> = configModule.default

  // The config might be a promise (common pattern with async buildConfig)
  if (config instanceof Promise) {
    config = await config
  }

  payloadInstance = await getPayload({ config })
  return payloadInstance
}

/**
 * Cleanly shut down Payload (close DB connections, etc.)
 */
export async function shutdownPayload(): Promise<void> {
  if (payloadInstance) {
    // Payload doesn't expose a public shutdown method on the instance,
    // but the DB adapter does. This ensures connections are closed.
    try {
      if (payloadInstance.db && typeof payloadInstance.db.destroy === 'function') {
        await payloadInstance.db.destroy()
      }
    } catch {
      // Ignore shutdown errors
    }
    payloadInstance = null
  }
}
