import type { Payload, SanitizedConfig } from 'payload'

let payloadInstance: Payload | null = null

/**
 * Initialize Payload using the local API (no HTTP server).
 * Caches the instance for the lifetime of the process.
 */
export async function getPayloadInstance(configPath: string): Promise<Payload> {
  if (payloadInstance) {
    return payloadInstance
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
