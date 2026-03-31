import type { Payload } from 'payload'
import { formatCollectionNotFoundError, formatValidationError } from '../output/errors.js'
import type { OutputOptions } from '../output/formatter.js'
import { info, output } from '../output/formatter.js'
import { formatFileSize, readFileForUpload, resolveFilePaths } from '../utils/file-utils.js'
import { parseFlags, positionalArgs } from '../utils/parse-flags.js'
import { getCollectionSlugs, isUploadCollection } from '../utils/schema-introspection.js'

/**
 * payload-agent upload <collection> <file|dir|glob...> [--data '{...}'] [--dry-run]
 *
 * Upload one or more files to an upload-enabled collection.
 *
 * Examples:
 *   payload-agent upload media ./hero.jpg
 *   payload-agent upload media ./hero.jpg --data '{"alt":"Hero image"}'
 *   payload-agent upload media ./photos/
 *   payload-agent upload media ./photos/*.jpg
 */
export async function uploadCommand(
  payload: Payload,
  args: string[],
  opts: Partial<OutputOptions> & { dryRun?: boolean },
): Promise<void> {
  const pos = positionalArgs(args)
  const slug = pos[0]

  if (!slug) {
    console.error(
      'Usage: payload-agent upload <collection> <file|dir> [--data \'{"alt":"..."}\']\n',
    )
    console.error('Examples:')
    console.error('  payload-agent upload media ./hero.jpg')
    console.error('  payload-agent upload media ./hero.jpg --data \'{"alt":"Hero image"}\'')
    console.error('  payload-agent upload media ./photos/')
    console.error('  payload-agent upload media ./img1.jpg ./img2.png')
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
    } else {
      console.error('No upload-enabled collections found in this Payload config.')
    }
    process.exit(1)
  }

  // File paths are all positional args after the collection slug
  const filePaths = pos.slice(1)
  if (filePaths.length === 0) {
    console.error('Error: No file path(s) provided.')
    console.error(`Usage: payload-agent upload ${slug} <file|dir> [--data '{...}']`)
    process.exit(1)
  }

  // Resolve file paths (handles directories, globs expanded by shell)
  let resolvedFiles: string[]
  try {
    resolvedFiles = await resolveFilePaths(filePaths)
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
    return
  }

  if (resolvedFiles.length === 0) {
    console.error('Error: No files found matching the provided path(s).')
    process.exit(1)
  }

  // Parse optional --data for metadata (alt text, etc.)
  const flags = parseFlags(args)
  let data: Record<string, unknown> = {}
  if (flags.data) {
    try {
      data = JSON.parse(flags.data) as Record<string, unknown>
    } catch {
      console.error('Error: Invalid JSON in --data flag.')
      console.error('Example: --data \'{"alt":"My image description"}\'')
      process.exit(1)
      return
    }
  }

  const isBulk = resolvedFiles.length > 1

  // Dry run: show what would be uploaded
  if (opts.dryRun) {
    info(`Dry run: would upload ${resolvedFiles.length} file(s) to '${slug}':`)
    for (const filePath of resolvedFiles) {
      const file = await readFileForUpload(filePath)
      console.log(`  ${file.name} (${file.mimetype}, ${formatFileSize(file.size)})`)
    }
    if (Object.keys(data).length > 0) {
      info('\nWith metadata:')
      output(data, opts)
    }
    return
  }

  // Upload files
  const results: Array<{
    file: string
    id: unknown
    success: boolean
    error?: string
  }> = []

  for (let i = 0; i < resolvedFiles.length; i++) {
    const filePath = resolvedFiles[i]
    let file: Awaited<ReturnType<typeof readFileForUpload>>

    try {
      file = await readFileForUpload(filePath)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push({ file: filePath, id: null, success: false, error: msg })
      if (isBulk) {
        console.error(`  [${i + 1}/${resolvedFiles.length}] Failed to read: ${filePath} -- ${msg}`)
      } else {
        console.error(`Error reading file: ${msg}`)
        process.exit(1)
      }
      continue
    }

    try {
      const result = await payload.create({
        collection: slug as Parameters<typeof payload.create>[0]['collection'],
        data: data as Record<string, unknown>,
        file,
        context: { disableRevalidate: true },
      })

      const resultObj = result as Record<string, unknown>
      results.push({ file: file.name, id: resultObj.id, success: true })

      if (isBulk) {
        console.log(
          `  [${i + 1}/${resolvedFiles.length}] Uploaded: ${file.name} (${formatFileSize(file.size)}) -> id: ${resultObj.id}`,
        )
      } else {
        console.log(
          `Uploaded '${file.name}' (${formatFileSize(file.size)}) to '${slug}' with id: ${resultObj.id}`,
        )
        output(result, opts)
      }
    } catch (error) {
      const msg = formatValidationError(error, slug)
      results.push({ file: file.name, id: null, success: false, error: msg })

      if (isBulk) {
        console.error(`  [${i + 1}/${resolvedFiles.length}] Failed: ${file.name} -- ${msg}`)
      } else {
        console.error(msg)
        process.exit(1)
      }
    }
  }

  // Bulk summary
  if (isBulk) {
    const succeeded = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    console.log(`\nUpload complete: ${succeeded} succeeded, ${failed} failed.`)

    if (opts.json) {
      output(results, opts)
    }

    if (failed > 0) {
      process.exit(1)
    }
  }
}
