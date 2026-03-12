import type { CollectionConfig, Field, Payload } from 'payload'
import type { OutputOptions } from '../output/formatter.js'
import { output, table } from '../output/formatter.js'

/**
 * payload-agent collections - List all collections with field counts.
 */
export async function collectionsCommand(
  payload: Payload,
  _args: string[],
  opts: Partial<OutputOptions>,
): Promise<void> {
  const collections = payload.config.collections

  if (opts.json) {
    output(
      collections.map((c: CollectionConfig) => ({
        slug: c.slug,
        label: typeof c.labels?.singular === 'string' ? c.labels.singular : c.slug,
        fieldCount: countFields(c.fields as Field[]),
        auth: Boolean(c.auth),
        upload: Boolean(c.upload),
      })),
      opts,
    )
    return
  }

  if (collections.length === 0) {
    console.log('No collections configured.')
    return
  }

  const headers = ['slug', 'fields', 'auth', 'upload']
  const rows = collections.map((c: CollectionConfig) => [
    c.slug,
    String(countFields(c.fields as Field[])),
    c.auth ? 'yes' : '',
    c.upload ? 'yes' : '',
  ])

  console.log(table(headers, rows))
  console.error(`\n${collections.length} collection(s)`)
}

function countFields(fields: Field[]): number {
  let count = 0
  for (const field of fields) {
    if (field.type === 'row' || field.type === 'collapsible') {
      if ('fields' in field && field.fields) {
        count += countFields(field.fields as Field[])
      }
    } else if (field.type === 'tabs') {
      if ('tabs' in field && field.tabs) {
        for (const tab of field.tabs as Array<{ fields: Field[] }>) {
          if (tab.fields) count += countFields(tab.fields)
        }
      }
    } else if (field.type !== 'ui') {
      count++
    }
  }
  return count
}
