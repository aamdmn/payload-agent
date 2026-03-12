/**
 * AI-friendly error formatting.
 * Transforms raw errors into actionable messages that tell the agent what to do next.
 */

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Suggest a similar field name if one exists.
 */
export function suggestField(input: string, available: string[]): string | null {
  let bestMatch: string | null = null
  let bestDistance = Infinity

  for (const field of available) {
    const distance = levenshtein(input.toLowerCase(), field.toLowerCase())
    if (distance < bestDistance && distance <= 3) {
      bestDistance = distance
      bestMatch = field
    }
  }

  return bestMatch
}

/**
 * Suggest a similar collection slug.
 */
export function suggestCollection(input: string, available: string[]): string | null {
  return suggestField(input, available)
}

/**
 * Format a Payload validation error into an AI-friendly message.
 */
export function formatValidationError(
  error: unknown,
  collection?: string,
  _availableFields?: string[],
): string {
  const lines: string[] = []

  if (error instanceof Error) {
    // Try to parse Payload validation errors
    const errAny = error as Record<string, unknown>

    if (errAny.data && typeof errAny.data === 'object') {
      const data = errAny.data as Record<string, unknown>
      if (data.errors && Array.isArray(data.errors)) {
        lines.push(`Validation failed${collection ? ` for collection '${collection}'` : ''}:`)
        for (const err of data.errors) {
          if (typeof err === 'object' && err !== null) {
            const fieldErr = err as { field?: string; message?: string }
            lines.push(
              `  - ${fieldErr.field || 'unknown field'}: ${fieldErr.message || 'validation error'}`,
            )
          }
        }
      } else {
        lines.push(`Error: ${error.message}`)
      }
    } else if (errAny.message) {
      lines.push(`Error: ${errAny.message}`)
    } else {
      lines.push(`Error: ${String(error)}`)
    }
  } else {
    lines.push(`Error: ${String(error)}`)
  }

  // Add hint
  if (collection) {
    lines.push('')
    lines.push(
      `Hint: Run 'payload-agent describe ${collection}' to see all available fields and their types.`,
    )
  }

  return lines.join('\n')
}

/**
 * Format a "collection not found" error with suggestions.
 */
export function formatCollectionNotFoundError(
  slug: string,
  availableCollections: string[],
): string {
  const lines: string[] = []
  lines.push(`Error: Collection '${slug}' does not exist.`)

  const suggestion = suggestCollection(slug, availableCollections)
  if (suggestion) {
    lines.push(`Did you mean '${suggestion}'?`)
  }

  lines.push('')
  lines.push('Available collections:')
  for (const col of availableCollections) {
    lines.push(`  - ${col}`)
  }
  lines.push('')
  lines.push("Hint: Run 'payload-agent collections' to see all collections.")

  return lines.join('\n')
}

/**
 * Format a "global not found" error with suggestions.
 */
export function formatGlobalNotFoundError(slug: string, availableGlobals: string[]): string {
  const lines: string[] = []
  lines.push(`Error: Global '${slug}' does not exist.`)

  const suggestion = suggestField(slug, availableGlobals)
  if (suggestion) {
    lines.push(`Did you mean '${suggestion}'?`)
  }

  lines.push('')
  if (availableGlobals.length > 0) {
    lines.push('Available globals:')
    for (const g of availableGlobals) {
      lines.push(`  - ${g}`)
    }
  } else {
    lines.push('No globals are configured in this Payload instance.')
  }
  lines.push('')
  lines.push("Hint: Run 'payload-agent globals' to see all globals.")

  return lines.join('\n')
}

/**
 * Format a generic error for agent consumption.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `Error: ${error.message}`
  }
  return `Error: ${String(error)}`
}
