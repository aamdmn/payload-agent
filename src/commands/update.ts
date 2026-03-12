import type { Payload, Where } from 'payload'
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
 * payload-agent update <collection> <id> --data '{...}' [--dry-run]
 */
export async function updateCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean },
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]
  const id = pos[1]

  if (!slug || !id) {
    console.error("Usage: payload-agent update <collection> <id> --data '{...}' [--dry-run]")
    process.exit(1)
  }

  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections))
    process.exit(1)
  }

  const flags = parseFlags(args)

  if (!flags.data) {
    console.error('Error: --data flag is required.')
    console.error(`Usage: payload-agent update ${slug} ${id} --data '{"title":"Updated Title"}'`)
    console.error(`Hint: Run 'payload-agent describe ${slug}' to see available fields.`)
    process.exit(1)
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(flags.data) as Record<string, unknown>
  } catch {
    console.error('Error: Invalid JSON in --data flag.')
    process.exit(1)
    return
  }

  // Check for unknown fields
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
    info(`Dry run: would update document '${id}' in '${slug}' with data:`)
    output(data, opts)
    return
  }

  try {
    const result = await payload.update({
      collection: slug as Parameters<typeof payload.update>[0]['collection'],
      id,
      data: data as Record<string, unknown>,
    })

    if (opts.json) {
      output(result, opts)
    } else {
      console.log(`Updated document '${id}' in '${slug}'.`)
      output(result, opts)
    }
  } catch (error) {
    console.error(formatValidationError(error, slug, knownFields))
    process.exit(1)
  }
}

/**
 * payload-agent update-many <collection> --where '{...}' --data '{...}' [--dry-run]
 */
export async function updateManyCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean },
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]
  if (!slug) {
    console.error(
      "Usage: payload-agent update-many <collection> --where '{...}' --data '{...}' [--dry-run]",
    )
    process.exit(1)
  }

  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections))
    process.exit(1)
  }

  const flags = parseFlags(args)

  if (!flags.where) {
    console.error('Error: --where flag is required for update-many.')
    console.error('This prevents accidentally updating all documents.')
    process.exit(1)
  }

  if (!flags.data) {
    console.error('Error: --data flag is required.')
    process.exit(1)
  }

  let where: Where
  try {
    where = JSON.parse(flags.where) as Where
  } catch {
    console.error('Error: Invalid JSON in --where flag.')
    process.exit(1)
    return
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(flags.data) as Record<string, unknown>
  } catch {
    console.error('Error: Invalid JSON in --data flag.')
    process.exit(1)
    return
  }

  if (opts.dryRun) {
    // Preview: find matching docs first
    const preview = await payload.find({
      collection: slug as Parameters<typeof payload.find>[0]['collection'],
      where,
      limit: 10,
    })
    info(`Dry run: would update ${preview.totalDocs} document(s) in '${slug}' with data:`)
    output(data, opts)
    if (preview.totalDocs > 0) {
      info('\nFirst 10 affected documents:')
      output(preview.docs, opts)
    }
    return
  }

  try {
    const result = await payload.update({
      collection: slug as Parameters<typeof payload.update>[0]['collection'],
      where,
      data: data as Record<string, unknown>,
    })

    const docs = 'docs' in result ? (result as { docs: unknown[] }).docs : [result]

    if (opts.json) {
      output(result, opts)
    } else {
      console.log(`Updated ${docs.length} document(s) in '${slug}'.`)
    }
  } catch (error) {
    console.error(formatValidationError(error, slug))
    process.exit(1)
  }
}
