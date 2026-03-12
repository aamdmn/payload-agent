import type { Payload, Where } from 'payload'
import { formatCollectionNotFoundError, formatValidationError } from '../output/errors.js'
import type { OutputOptions } from '../output/formatter.js'
import { output, paginationInfo } from '../output/formatter.js'
import { parseFlags, positionalArgs } from '../utils/parse-flags.js'
import { getCollectionSlugs } from '../utils/schema-introspection.js'

/**
 * payload-agent find <collection> [--where '...'] [--limit N] [--page N] [--sort field] [--select '...'] [--depth N]
 */
export async function findCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions>,
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]
  if (!slug) {
    console.error(
      "Usage: payload-agent find <collection> [--where '{...}'] [--limit N] [--page N] [--sort field] [--select '{...}'] [--depth N]",
    )
    process.exit(1)
  }

  // Validate collection
  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections))
    process.exit(1)
  }

  const flags = parseFlags(args)

  // Parse optional parameters
  const findArgs: Record<string, unknown> = {
    collection: slug,
  }

  if (flags.where) {
    try {
      findArgs.where = JSON.parse(flags.where) as Where
    } catch {
      console.error('Error: Invalid JSON in --where flag.')
      console.error('Example: --where \'{"status":{"equals":"published"}}\'')
      process.exit(1)
    }
  }

  if (flags.limit) findArgs.limit = parseInt(flags.limit, 10)
  if (flags.page) findArgs.page = parseInt(flags.page, 10)
  if (flags.sort) findArgs.sort = flags.sort
  if (flags.depth) findArgs.depth = parseInt(flags.depth, 10)

  if (flags.select) {
    try {
      findArgs.select = JSON.parse(flags.select)
    } catch {
      console.error('Error: Invalid JSON in --select flag.')
      console.error('Example: --select \'{"title":true,"slug":true}\'')
      process.exit(1)
    }
  }

  try {
    const result = await payload.find(findArgs as Parameters<typeof payload.find>[0])

    if (opts.json) {
      output(result, opts)
      return
    }

    // Human-readable
    if (result.docs.length === 0) {
      console.log(`No documents found in '${slug}'.`)
      return
    }

    output(result.docs, opts)
    console.error(`\n${paginationInfo(result)}`)
  } catch (error) {
    console.error(formatValidationError(error, slug))
    process.exit(1)
  }
}

/**
 * payload-agent find-by-id <collection> <id> [--select '...'] [--depth N]
 */
export async function findByIdCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions>,
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]
  const id = pos[1]

  if (!slug || !id) {
    console.error(
      "Usage: payload-agent find-by-id <collection> <id> [--select '{...}'] [--depth N]",
    )
    process.exit(1)
  }

  // Validate collection
  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections))
    process.exit(1)
  }

  const flags = parseFlags(args)

  const findArgs: Record<string, unknown> = {
    collection: slug,
    id,
  }

  if (flags.depth) findArgs.depth = parseInt(flags.depth, 10)

  if (flags.select) {
    try {
      findArgs.select = JSON.parse(flags.select)
    } catch {
      console.error('Error: Invalid JSON in --select flag.')
      process.exit(1)
    }
  }

  try {
    const result = await payload.findByID(findArgs as Parameters<typeof payload.findByID>[0])
    output(result, opts)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    if (errMsg.includes('not found') || errMsg.includes('Not Found')) {
      console.error(`Error: Document '${id}' not found in collection '${slug}'.`)
      console.error(`Hint: Run 'payload-agent find ${slug} --limit 5' to see existing documents.`)
    } else {
      console.error(formatValidationError(error, slug))
    }
    process.exit(1)
  }
}
