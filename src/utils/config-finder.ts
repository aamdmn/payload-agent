import fs from 'node:fs'
import path from 'node:path'

const CONFIG_FILENAMES = [
  'payload.config.ts',
  'src/payload.config.ts',
  'app/payload.config.ts',
  'src/app/payload.config.ts',
]

/**
 * Find the payload.config.ts file.
 * Priority: --config flag > PAYLOAD_CONFIG_PATH env var > auto-detect
 */
export function findPayloadConfig(explicitPath?: string): string {
  // 1. Explicit path from --config flag
  if (explicitPath) {
    const resolved = path.resolve(explicitPath)
    if (!fs.existsSync(resolved)) {
      throw new ConfigNotFoundError(
        `Config file not found at: ${resolved}\nThe path provided via --config does not exist.`,
      )
    }
    loadEnvFromConfigDir(resolved)
    return resolved
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
    return resolved
  }

  // 3. Auto-detect in common locations
  const cwd = process.cwd()
  for (const filename of CONFIG_FILENAMES) {
    const candidate = path.resolve(cwd, filename)
    if (fs.existsSync(candidate)) {
      loadEnvFromConfigDir(candidate)
      return candidate
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
