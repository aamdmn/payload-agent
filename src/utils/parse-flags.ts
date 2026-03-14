/**
 * Parse --flag value pairs from an argument array.
 * Supports: --flag value, --flag=value, --boolean-flag
 *
 * For single-value flags, later values overwrite earlier ones.
 * Use `parseFlagsMulti` for flags that can appear multiple times.
 */
export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (!arg.startsWith('--')) continue

    // Handle --flag=value
    if (arg.includes('=')) {
      const [key, ...valueParts] = arg.slice(2).split('=')
      flags[toCamelCase(key)] = valueParts.join('=')
      continue
    }

    // Handle --flag value or --boolean-flag
    const key = arg.slice(2)
    const nextArg = args[i + 1]

    if (nextArg && !nextArg.startsWith('--')) {
      flags[toCamelCase(key)] = nextArg
      i++ // Skip the value
    } else {
      // Boolean flag
      flags[toCamelCase(key)] = 'true'
    }
  }

  return flags
}

/**
 * Parse flags that can appear multiple times, returning arrays of values.
 * e.g. --file 'a=./x.jpg' --file 'b=./y.jpg' => { file: ['a=./x.jpg', 'b=./y.jpg'] }
 *
 * Boolean flags are still returned as single 'true' strings in an array.
 */
export function parseFlagsMulti(args: string[]): Record<string, string[]> {
  const flags: Record<string, string[]> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (!arg.startsWith('--')) continue

    // Handle --flag=value
    if (arg.includes('=')) {
      const [key, ...valueParts] = arg.slice(2).split('=')
      const camel = toCamelCase(key)
      if (!flags[camel]) flags[camel] = []
      flags[camel].push(valueParts.join('='))
      continue
    }

    // Handle --flag value or --boolean-flag
    const key = arg.slice(2)
    const camel = toCamelCase(key)
    const nextArg = args[i + 1]

    if (nextArg && !nextArg.startsWith('--')) {
      if (!flags[camel]) flags[camel] = []
      flags[camel].push(nextArg)
      i++ // Skip the value
    } else {
      if (!flags[camel]) flags[camel] = []
      flags[camel].push('true')
    }
  }

  return flags
}

/**
 * Extract positional (non-flag) arguments from an args array.
 * Skips flags and their values.
 */
export function positionalArgs(args: string[]): string[] {
  const result: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      // Skip flag. If --flag=value, it's self-contained.
      // If --flag value, skip the next arg too.
      if (!arg.includes('=')) {
        const nextArg = args[i + 1]
        if (nextArg && !nextArg.startsWith('--')) {
          i++ // Skip the value
        }
      }
      continue
    }
    result.push(arg)
  }

  return result
}

/**
 * Convert kebab-case to camelCase.
 */
function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}
