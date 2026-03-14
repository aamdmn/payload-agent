import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Mime type mapping based on file extension.
 * Covers the most common media types; falls back to 'application/octet-stream'.
 */
const MIME_MAP: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.bmp': 'image/bmp',

  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',

  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',

  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',

  // Archives
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',

  // Web
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

/**
 * The file object shape that Payload's Local API expects.
 */
export interface PayloadFile {
  data: Buffer
  mimetype: string
  name: string
  size: number
}

/**
 * Get the mimetype for a file based on its extension.
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_MAP[ext] || 'application/octet-stream'
}

/**
 * Read a file from disk and construct a Payload-compatible file object.
 */
export async function readFileForUpload(filePath: string): Promise<PayloadFile> {
  const resolved = path.resolve(filePath)

  try {
    await fs.access(resolved, fs.constants.R_OK)
  } catch {
    throw new Error(`File not found or not readable: ${resolved}`)
  }

  const data = await fs.readFile(resolved)
  const name = path.basename(resolved)
  const mimetype = getMimeType(resolved)

  return {
    data,
    mimetype,
    name,
    size: data.byteLength,
  }
}

/**
 * Resolve file paths from a list of arguments.
 *
 * Each argument can be:
 *   - A path to a single file
 *   - A path to a directory (all files in the directory are included, non-recursive)
 *   - A glob pattern (shell-expanded before reaching us, so each arg is already a resolved path)
 *
 * Returns absolute paths to all resolved files.
 */
export async function resolveFilePaths(paths: string[]): Promise<string[]> {
  const result: string[] = []

  for (const p of paths) {
    const resolved = path.resolve(p)
    let stat: Awaited<ReturnType<typeof fs.stat>>

    try {
      stat = await fs.stat(resolved)
    } catch {
      throw new Error(`Path not found: ${resolved}`)
    }

    if (stat.isDirectory()) {
      // Read all files in directory (non-recursive, skip hidden files)
      const entries = await fs.readdir(resolved)
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        const entryPath = path.join(resolved, entry)
        const entryStat = await fs.stat(entryPath)
        if (entryStat.isFile()) {
          result.push(entryPath)
        }
      }
    } else if (stat.isFile()) {
      result.push(resolved)
    }
  }

  return result
}

/**
 * Format a file size in bytes to a human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
