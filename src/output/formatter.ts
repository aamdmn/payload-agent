import { redact } from './redact.js'

export interface OutputOptions {
  json: boolean
  includeSensitive: boolean
}

const defaultOptions: OutputOptions = {
  json: false,
  includeSensitive: false,
}

/**
 * Format and print data to stdout.
 * Handles JSON mode, redaction, and human-readable formatting.
 */
export function output(data: unknown, opts: Partial<OutputOptions> = {}): void {
  const options = { ...defaultOptions, ...opts }
  const processed = options.includeSensitive ? data : redact(data)

  if (options.json) {
    console.log(JSON.stringify(processed, null, 2))
    return
  }

  // Human-readable mode
  if (typeof processed === 'string') {
    console.log(processed)
  } else {
    console.log(formatHuman(processed))
  }
}

/**
 * Print an informational message (not data - goes to stderr so it doesn't pollute piped JSON).
 */
export function info(message: string): void {
  console.error(message)
}

/**
 * Print a success message.
 */
export function success(message: string): void {
  console.error(`OK: ${message}`)
}

/**
 * Format data for human-readable output.
 */
function formatHuman(data: unknown, indent = 0): string {
  if (data === null || data === undefined) {
    return 'null'
  }

  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return String(data)
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty)'
    return data.map((item, i) => `${pad(indent)}[${i}] ${formatHuman(item, indent + 2)}`).join('\n')
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return '{}'

    return entries
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return `${pad(indent)}${key}:\n${formatHuman(value, indent + 2)}`
        }
        if (Array.isArray(value)) {
          if (value.length === 0) return `${pad(indent)}${key}: (empty)`
          return `${pad(indent)}${key}:\n${formatHuman(value, indent + 2)}`
        }
        return `${pad(indent)}${key}: ${formatValue(value)}`
      })
      .join('\n')
  }

  return String(data)
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') {
    // Truncate long strings in human mode
    if (value.length > 200) {
      return `"${value.slice(0, 200)}..." (${value.length} chars)`
    }
    return `"${value}"`
  }
  return String(value)
}

function pad(indent: number): string {
  return ' '.repeat(indent)
}

/**
 * Format a table of rows for human-readable output.
 */
export function table(headers: string[], rows: string[][]): string {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0)
    return Math.max(h.length, maxRow)
  })

  const separator = widths.map((w) => '-'.repeat(w)).join('  ')
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ')
  const bodyLines = rows.map((row) =>
    row.map((cell, i) => (cell || '').padEnd(widths[i])).join('  '),
  )

  return [headerLine, separator, ...bodyLines].join('\n')
}

/**
 * Format pagination info.
 */
export function paginationInfo(result: {
  totalDocs: number
  page?: number | undefined
  totalPages?: number | undefined
  limit: number
  hasNextPage: boolean
}): string {
  const parts: string[] = []
  parts.push(`${result.totalDocs} total`)
  if (result.page !== undefined && result.totalPages !== undefined) {
    parts.push(`page ${result.page}/${result.totalPages}`)
  }
  if (result.hasNextPage) {
    parts.push('more pages available')
  }
  return parts.join(', ')
}
