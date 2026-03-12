import type { Payload } from 'payload'
import {
  formatCollectionNotFoundError,
  formatValidationError,
  suggestField,
} from '../output/errors.js'
import type { OutputOptions } from '../output/formatter.js'
import { info, output } from '../output/formatter.js'
import { parseFlags, positionalArgs } from '../utils/parse-flags.js'
import { getCollectionSlugs, getFieldNames } from '../utils/schema-introspection.js'

/**
 * payload-agent create <collection> --data '{...}' [--dry-run]
 */
export async function createCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean },
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]
  if (!slug) {
    console.error("Usage: payload-agent create <collection> --data '{...}' [--dry-run]")
    process.exit(1)
  }

  // Validate collection
  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections))
    process.exit(1)
  }

  const flags = parseFlags(args)

  if (!flags.data) {
    console.error('Error: --data flag is required.')
    console.error(`Usage: payload-agent create ${slug} --data '{"title":"My Post"}'`)
    console.error(`Hint: Run 'payload-agent describe ${slug}' to see available fields.`)
    process.exit(1)
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(flags.data) as Record<string, unknown>
  } catch {
    console.error('Error: Invalid JSON in --data flag.')
    console.error(`Example: --data '{"title":"My Post","status":"draft"}'`)
    process.exit(1)
    return // unreachable but helps TypeScript
  }

  // Check for unknown field names and suggest corrections
  const knownFields = getFieldNames(payload, slug)
  if (knownFields.length > 0) {
    for (const key of Object.keys(data)) {
      if (!knownFields.includes(key)) {
        const suggestion = suggestField(key, knownFields)
        if (suggestion) {
          console.error(
            `Warning: Field '${key}' does not exist on '${slug}'. Did you mean '${suggestion}'?`,
          )
        }
      }
    }
  }

  if (opts.dryRun) {
    info(`Dry run: would create document in '${slug}' with data:`)
    output(data, opts)
    return
  }

  try {
    const result = await payload.create({
      collection: slug as Parameters<typeof payload.create>[0]['collection'],
      data: data as Record<string, unknown>,
    })

    if (opts.json) {
      output(result, opts)
    } else {
      const resultObj = result as Record<string, unknown>
      console.log(`Created document in '${slug}' with id: ${resultObj.id}`)
      output(result, opts)
    }
  } catch (error) {
    console.error(formatValidationError(error, slug, knownFields))
    process.exit(1)
  }
}
