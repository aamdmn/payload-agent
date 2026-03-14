import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Payload, Where } from 'payload'
import { formatCollectionNotFoundError } from '../output/errors.js'
import type { OutputOptions } from '../output/formatter.js'
import { info } from '../output/formatter.js'
import { formatFileSize } from '../utils/file-utils.js'
import { parseFlags, positionalArgs } from '../utils/parse-flags.js'
import { getCollectionSlugs, isUploadCollection } from '../utils/schema-introspection.js'

/**
 * payload-agent download <collection> <id> [--out ./path/]
 * payload-agent download <collection> --where '{...}' [--out ./path/]
 *
 * Download media files from an upload-enabled collection.
 *
 * Examples:
 *   payload-agent download media 6789abcdef
 *   payload-agent download media 6789abcdef --out ./downloads/
 *   payload-agent download media --where '{"alt":{"contains":"hero"}}'
 */
export async function downloadCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean },
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]
  const id = pos[1]

  if (!slug) {
    console.error('Usage: payload-agent download <collection> <id> [--out ./path/]\n')
    console.error('Examples:')
    console.error('  payload-agent download media 6789abcdef')
    console.error('  payload-agent download media 6789abcdef --out ./downloads/')
    console.error('  payload-agent download media --where \'{"alt":{"contains":"hero"}}\'')
    process.exit(1)
  }

  // Validate collection exists
  const collections = getCollectionSlugs(payload)
  if (!collections.includes(slug)) {
    console.error(formatCollectionNotFoundError(slug, collections))
    process.exit(1)
  }

  // Validate collection is upload-enabled
  if (!isUploadCollection(payload, slug)) {
    console.error(`Error: Collection '${slug}' is not upload-enabled.`)
    const uploadCollections = collections.filter((c) => isUploadCollection(payload, c))
    if (uploadCollections.length > 0) {
      console.error(`Upload-enabled collections: ${uploadCollections.join(', ')}`)
    }
    process.exit(1)
  }

  const flags = parseFlags(args)
  const outDir = flags.out ? path.resolve(flags.out) : process.cwd()

  // Ensure output directory exists
  try {
    await fs.mkdir(outDir, { recursive: true })
  } catch (error) {
    console.error(
      `Error: Could not create output directory '${outDir}': ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }

  // Fetch documents
  type MediaDoc = Record<string, unknown> & {
    id: string | number
    filename?: string
    url?: string
  }

  let docs: MediaDoc[] = []

  if (id) {
    // Single document by ID
    try {
      const doc = (await payload.findByID({
        collection: slug as Parameters<typeof payload.findByID>[0]['collection'],
        id,
      })) as MediaDoc
      docs = [doc]
    } catch (error) {
      console.error(
        `Error: Could not find document '${id}' in '${slug}': ${error instanceof Error ? error.message : String(error)}`,
      )
      process.exit(1)
    }
  } else if (flags.where) {
    // Query-based
    let where: Where
    try {
      where = JSON.parse(flags.where) as Where
    } catch {
      console.error('Error: Invalid JSON in --where flag.')
      process.exit(1)
      return
    }

    try {
      const result = await payload.find({
        collection: slug as Parameters<typeof payload.find>[0]['collection'],
        where,
        limit: flags.limit ? Number.parseInt(flags.limit, 10) : 100,
      })
      docs = result.docs as MediaDoc[]
    } catch (error) {
      console.error(
        `Error: Query failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      process.exit(1)
    }

    if (docs.length === 0) {
      console.error('No documents found matching the query.')
      process.exit(1)
    }
  } else {
    console.error('Error: Provide a document ID or use --where to query documents.')
    console.error(`Usage: payload-agent download ${slug} <id> [--out ./path/]`)
    console.error(
      `       payload-agent download ${slug} --where '{"alt":{"contains":"hero"}}' [--out ./path/]`,
    )
    process.exit(1)
  }

  // Resolve the base URL for fetching files
  const serverURL = payload.config.serverURL || ''

  // Dry run
  if (opts.dryRun) {
    info(`Dry run: would download ${docs.length} file(s) to '${outDir}':`)
    for (const doc of docs) {
      console.log(`  ${doc.filename || doc.id} (url: ${doc.url || 'N/A'})`)
    }
    return
  }

  // Download each file
  const results: Array<{
    file: string
    success: boolean
    size?: number
    error?: string
  }> = []
  const isBulk = docs.length > 1

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]
    const filename = doc.filename || `${doc.id}`
    const url = doc.url

    if (!url) {
      const msg = `No URL found for document '${doc.id}'.`
      results.push({ file: filename, success: false, error: msg })
      if (isBulk) {
        console.error(`  [${i + 1}/${docs.length}] Skipped: ${filename} -- ${msg}`)
      } else {
        console.error(`Error: ${msg}`)
        process.exit(1)
      }
      continue
    }

    // Build full URL
    let fullUrl: string
    if (url.startsWith('http://') || url.startsWith('https://')) {
      fullUrl = url
    } else if (serverURL) {
      fullUrl = `${serverURL.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
    } else {
      const msg = `File URL '${url}' is relative but no serverURL is configured in the Payload config. Cannot download.`
      results.push({ file: filename, success: false, error: msg })
      if (isBulk) {
        console.error(`  [${i + 1}/${docs.length}] Skipped: ${filename} -- ${msg}`)
      } else {
        console.error(`Error: ${msg}`)
        console.error(
          'Hint: Set serverURL in your payload.config.ts, or provide a full URL in the collection.',
        )
        process.exit(1)
      }
      continue
    }

    try {
      const response = await fetch(fullUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const outPath = path.join(outDir, filename)

      await fs.writeFile(outPath, buffer)
      results.push({ file: filename, success: true, size: buffer.byteLength })

      if (isBulk) {
        console.log(
          `  [${i + 1}/${docs.length}] Downloaded: ${filename} (${formatFileSize(buffer.byteLength)})`,
        )
      } else {
        console.log(`Downloaded '${filename}' (${formatFileSize(buffer.byteLength)}) to ${outPath}`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push({ file: filename, success: false, error: msg })

      if (isBulk) {
        console.error(`  [${i + 1}/${docs.length}] Failed: ${filename} -- ${msg}`)
      } else {
        console.error(`Error downloading '${filename}': ${msg}`)
        process.exit(1)
      }
    }
  }

  // Bulk summary
  if (isBulk) {
    const succeeded = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    const totalSize = results
      .filter((r) => r.success && r.size)
      .reduce((sum, r) => sum + (r.size || 0), 0)

    console.log(
      `\nDownload complete: ${succeeded} succeeded (${formatFileSize(totalSize)}), ${failed} failed.`,
    )

    if (failed > 0) {
      process.exit(1)
    }
  }
}
