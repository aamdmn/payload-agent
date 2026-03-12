import fs from 'node:fs'
import path from 'node:path'

const CONFIG_FILENAMES = [
  'payload.config.ts',
  'src/payload.config.ts',
  'app/payload.config.ts',
  'src/app/payload.config.ts',
]

const TSCONFIG_FILENAMES = ['tsconfig.json']

export interface ConfigResult {
  configPath: string
  tsconfigPath?: string
}

/**
 * Find the tsconfig.json nearest to the payload config.
 * Walks up from the config file's directory.
 */
function findTsConfig(configPath: string): string | undefined {
  let dir = path.dirname(path.resolve(configPath))
  const root = path.parse(dir).root

  while (dir !== root) {
    for (const filename of TSCONFIG_FILENAMES) {
      const candidate = path.join(dir, filename)
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * Parse a tsconfig.json file and extract paths and baseUrl.
 * Handles the "extends" field for inherited configs.
 */
export function parseTsConfigPaths(tsconfigPath: string): {
  paths: Record<string, string[]>
  baseUrl: string
} | null {
  try {
    const content = fs.readFileSync(tsconfigPath, 'utf-8')
    // Strip comments (simple approach: remove // comments and /* */ blocks)
    const stripped = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove trailing commas before } or ]
      .replace(/,\s*([}\]])/g, '$1')
    const config = JSON.parse(stripped)

    const compilerOptions = config.compilerOptions || {}
    const paths = compilerOptions.paths

    if (!paths || Object.keys(paths).length === 0) {
      return null
    }

    const tsconfigDir = path.dirname(tsconfigPath)
    const baseUrl = compilerOptions.baseUrl
      ? path.resolve(tsconfigDir, compilerOptions.baseUrl)
      : tsconfigDir

    return { paths, baseUrl }
  } catch {
    return null
  }
}

/**
 * Find the payload.config.ts file.
 * Priority: --config flag > PAYLOAD_CONFIG_PATH env var > auto-detect
 */
export function findPayloadConfig(explicitPath?: string): ConfigResult {
  // 1. Explicit path from --config flag
  if (explicitPath) {
    const resolved = path.resolve(explicitPath)
    if (!fs.existsSync(resolved)) {
      throw new ConfigNotFoundError(
        `Config file not found at: ${resolved}\nThe path provided via --config does not exist.`,
      )
    }
    loadEnvFromConfigDir(resolved)
    return { configPath: resolved, tsconfigPath: findTsConfig(resolved) }
  }

  // 2. PAYLOAD_CONFIG_PATH env var
  const envPath = process.env.PAYLOAD_CONFIG_PATH
  if (envPath) {
    const resolved = path.resolve(envPath)
    if (!fs.existsSync(resolved)) {
      throw new ConfigNotFoundError(
        `Config file not found at: ${resolved}\nPAYLOAD_CONFIG_PATH is set but the file does not exist.`,
      )
    }
    loadEnvFromConfigDir(resolved)
    return { configPath: resolved, tsconfigPath: findTsConfig(resolved) }
  }

  // 3. Auto-detect in common locations
  const cwd = process.cwd()
  for (const filename of CONFIG_FILENAMES) {
    const candidate = path.resolve(cwd, filename)
    if (fs.existsSync(candidate)) {
      loadEnvFromConfigDir(candidate)
      return { configPath: candidate, tsconfigPath: findTsConfig(candidate) }
    }
  }

  throw new ConfigNotFoundError(
    `Could not find payload.config.ts in any of these locations:\n${CONFIG_FILENAMES.map((f) => `  - ${path.resolve(cwd, f)}`).join('\n')}\n\nSet PAYLOAD_CONFIG_PATH env var or use --config <path>.`,
  )
}

/**
 * Load .env file from the config's directory if it exists.
 * This ensures DATABASE_URL, PAYLOAD_SECRET, etc. are available
 * when running payload-agent from outside the project directory.
 *
 * Uses a simple parser -- no dependency on dotenv.
 * Only sets variables that are NOT already set in the environment.
 */
function loadEnvFromConfigDir(configPath: string): void {
  // Walk up from config file to find .env
  let dir = path.dirname(path.resolve(configPath))
  const root = path.parse(dir).root

  while (dir !== root) {
    const envFile = path.join(dir, '.env')
    if (fs.existsSync(envFile)) {
      parseEnvFile(envFile)
      return
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}

/**
 * Parse a .env file and set variables that don't already exist.
 */
function parseEnvFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // Only set if not already in environment
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

export class ConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigNotFoundError'
  }
}
