import type { Payload } from 'payload'
import type { OutputOptions } from '../output/formatter.js'
import { output } from '../output/formatter.js'
import { formatLocales, getLocaleConfig } from '../utils/locale.js'

/**
 * payload-agent status - Show Payload instance status.
 */
export async function statusCommand(
  payload: Payload,
  _args: string[],
  opts: Partial<OutputOptions>,
): Promise<void> {
  const config = payload.config
  const localeConfig = getLocaleConfig(payload)

  const status: Record<string, unknown> = {
    connected: true,
    collections: config.collections.length,
    globals: (config.globals || []).length,
    localization: localeConfig
      ? {
          enabled: true,
          locales: localeConfig.locales,
          defaultLocale: localeConfig.defaultLocale,
        }
      : { enabled: false },
    serverURL: config.serverURL || '(not set)',
  }

  if (opts.json) {
    output(
      {
        ...status,
        collectionSlugs: config.collections.map((c) => c.slug),
        globalSlugs: (config.globals || []).map((g) => g.slug),
      },
      opts,
    )
    return
  }

  const lines: string[] = []
  lines.push('Payload Status')
  lines.push('-'.repeat(40))
  lines.push('Connected:     yes')
  lines.push(`Collections:   ${config.collections.length}`)
  lines.push(`Globals:       ${(config.globals || []).length}`)
  lines.push(`Localization:  ${localeConfig ? formatLocales(localeConfig) : 'disabled'}`)
  lines.push(`Server URL:    ${config.serverURL || '(not set)'}`)

  if (config.collections.length > 0) {
    lines.push('')
    lines.push('Collections:')
    for (const c of config.collections) {
      const flags: string[] = []
      if (c.auth) {
        flags.push('auth')
      }
      if (c.upload) {
        flags.push('upload')
      }
      const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : ''
      lines.push(`  - ${c.slug}${flagStr}`)
    }
  }

  if (config.globals && config.globals.length > 0) {
    lines.push('')
    lines.push('Globals:')
    for (const g of config.globals) {
      lines.push(`  - ${g.slug}`)
    }
  }

  console.log(lines.join('\n'))
}
