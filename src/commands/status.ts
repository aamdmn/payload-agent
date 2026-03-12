import type { Payload } from 'payload'
import type { OutputOptions } from '../output/formatter.js'
import { output } from '../output/formatter.js'

/**
 * payload-agent status - Show Payload instance status.
 */
export async function statusCommand(
  payload: Payload,
  _args: string[],
  opts: Partial<OutputOptions>,
): Promise<void> {
  const config = payload.config

  const status = {
    connected: true,
    collections: config.collections.length,
    globals: (config.globals || []).length,
    localization: Boolean(config.localization),
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
  lines.push(`Connected:     yes`)
  lines.push(`Collections:   ${status.collections}`)
  lines.push(`Globals:       ${status.globals}`)
  lines.push(`Localization:  ${status.localization ? 'enabled' : 'disabled'}`)
  lines.push(`Server URL:    ${status.serverURL}`)

  if (config.collections.length > 0) {
    lines.push('')
    lines.push('Collections:')
    for (const c of config.collections) {
      const flags: string[] = []
      if (c.auth) flags.push('auth')
      if (c.upload) flags.push('upload')
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
