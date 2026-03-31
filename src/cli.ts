// Commands
import { collectionsCommand } from './commands/collections.js'
import { copyLocaleCommand, copyLocaleGlobalCommand } from './commands/copy-locale.js'
import { createCommand } from './commands/create.js'
import { deleteCommand, deleteManyCommand } from './commands/delete.js'
import { describeCommand } from './commands/describe.js'
import { downloadCommand } from './commands/download.js'
import { findByIdCommand, findCommand } from './commands/find.js'
import { getGlobalCommand, globalsCommand, updateGlobalCommand } from './commands/globals.js'
import { statusCommand } from './commands/status.js'
import { updateCommand, updateManyCommand } from './commands/update.js'
import { uploadCommand } from './commands/upload.js'
import type { OutputOptions } from './output/formatter.js'
import { ConfigNotFoundError, findPayloadConfig } from './utils/config-finder.js'
import { parseFlags } from './utils/parse-flags.js'
import { getPayloadInstance, shutdownPayload } from './utils/payload-init.js'

const VERSION = '0.3.1'

const HELP = `payload-agent - PayloadCMS CLI for AI agents and humans

Usage: payload-agent <command> [arguments] [flags]

Introspection:
  collections                         List all collections
  describe <collection|global>        Show full schema for a collection or global
  globals                             List all globals
  status                              Show Payload instance status

Read:
  find <collection> [flags]           Find documents
  find-by-id <collection> <id>        Find a document by ID

Write:
  create <collection> --data '{...}'  Create a document
  update <collection> <id> --data     Update a document
  update-many <collection> --where    Bulk update documents
    --data '{...}'

Media:
  upload <collection> <file|dir>      Upload file(s) to an upload collection
  download <collection> <id>          Download file(s) from an upload collection
    [--out ./path/]

Delete (requires --confirm):
  delete <collection> <id>            Delete a document
  delete-many <collection> --where    Bulk delete documents

Globals:
  get-global <slug>                   Get a global
  update-global <slug> --data '{...}' Update a global

Localization:
  copy-locale <collection> --from     Copy localized fields between locales
    <locale> --to <locale>
  copy-locale-global <slug> --from    Copy localized global fields between locales
    <locale> --to <locale>

Global Flags:
  --json                  Output as JSON (for machine parsing)
  --dry-run               Validate without executing writes
  --confirm               Confirm destructive operations
  --config <path>         Path to payload.config.ts
  --locale <code>         Locale for reading/writing localized fields (use "all" to see all locales)
  --fallback-locale <code> Fallback locale for reads (use "none" to disable fallback)
  --include-sensitive      Include sensitive fields in output
  --help, -h              Show this help
  --version, -v           Show version

Examples:
  payload-agent collections
  payload-agent describe posts
  payload-agent find posts --limit 5
  payload-agent find posts --where '{"status":{"equals":"published"}}'
  payload-agent find-by-id posts 6789abcdef
  payload-agent find-by-id posts 6789abcdef --locale all
  payload-agent create posts --data '{"title":"Hello World"}'
  payload-agent update posts 6789abcdef --data '{"title":"Updated"}'
  payload-agent update posts 6789abcdef --data '{"title":"Ahoj"}' --locale cz
  payload-agent update-many posts --where '{}' --data '{"price":1149}' --locale cz
  payload-agent delete posts 6789abcdef --confirm
  payload-agent get-global site-settings
  payload-agent get-global header --locale cz
  payload-agent update-global header --data '{"title":"Updated"}' --locale cz
  payload-agent copy-locale products --from en --to fr
  payload-agent copy-locale-global header --from en --to fr
  payload-agent upload media ./hero.jpg --data '{"alt":"Hero"}'
  payload-agent upload media ./photos/
  payload-agent download media 6789abcdef --out ./downloads/
  payload-agent create pages --data '{"title":"About"}' --file 'heroImage=./hero.jpg'
  payload-agent create pages --data @content.json

Workflow for agents:
  1. payload-agent collections          -> discover what's available
  2. payload-agent describe posts       -> learn the schema
  3. payload-agent find posts --limit 3 -> see existing data
  4. payload-agent create posts --data  -> create content
  5. payload-agent find-by-id posts <id> -> verify your changes
`

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)

  // Extract global flags before command routing
  const globalFlags = parseFlags(rawArgs)
  const isJson = globalFlags.json === 'true'
  const isDryRun = globalFlags.dryRun === 'true'
  const isConfirm = globalFlags.confirm === 'true'
  const includeSensitive = globalFlags.includeSensitive === 'true'
  const configPath = globalFlags.config

  const outputOpts: Partial<OutputOptions> & {
    dryRun?: boolean
    confirm?: boolean
  } = {
    json: isJson,
    includeSensitive,
    dryRun: isDryRun,
    confirm: isConfirm,
  }

  // Find the command (first positional argument)
  // Then pass ALL remaining args (including flags) to the command handler
  // so it can parse its own command-specific flags like --data, --where, etc.
  let command: string | undefined
  let commandStartIndex = 0

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (arg === '-h' || arg === '-v') {
      continue
    }
    if (arg.startsWith('--')) {
      // Skip global flags and their values
      if (!arg.includes('=')) {
        const nextArg = rawArgs[i + 1]
        if (nextArg && !nextArg.startsWith('--')) {
          i++ // Skip the value
        }
      }
      continue
    }
    // First non-flag argument is the command
    command = arg
    commandStartIndex = i + 1
    break
  }

  // Everything after the command goes to the handler (positional + flags)
  const args = rawArgs.slice(commandStartIndex)

  if (globalFlags.version === 'true' || rawArgs.includes('-v')) {
    console.log(VERSION)
    return
  }

  // Handle help before initializing Payload
  if (!command || globalFlags.help === 'true' || rawArgs.includes('-h')) {
    console.log(HELP)
    return
  }

  // Initialize Payload
  let configFile: string
  let tsconfigFile: string | undefined
  try {
    const result = findPayloadConfig(configPath)
    configFile = result.configPath
    tsconfigFile = result.tsconfigPath
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }

  // Suppress Payload's noisy startup logs
  const originalConsoleLog = console.log
  if (!process.env.PAYLOAD_AGENT_VERBOSE) {
    console.log = () => {}
  }

  let payload: Awaited<ReturnType<typeof getPayloadInstance>> | undefined
  try {
    payload = await getPayloadInstance(configFile, tsconfigFile)
  } catch (error) {
    console.log = originalConsoleLog
    console.error('Error: Failed to initialize Payload.')
    if (error instanceof Error) {
      console.error(error.message)
    }
    process.exit(1)
  } finally {
    console.log = originalConsoleLog
  }

  // Route to command handler
  try {
    switch (command) {
      case 'collections':
        await collectionsCommand(payload, args, outputOpts)
        break

      case 'describe':
        await describeCommand(payload, args, outputOpts)
        break

      case 'find':
        await findCommand(payload, args, outputOpts)
        break

      case 'find-by-id':
        await findByIdCommand(payload, args, outputOpts)
        break

      case 'create':
        await createCommand(payload, args, outputOpts)
        break

      case 'update':
        await updateCommand(payload, args, outputOpts)
        break

      case 'update-many':
        await updateManyCommand(payload, args, outputOpts)
        break

      case 'delete':
        await deleteCommand(payload, args, outputOpts)
        break

      case 'delete-many':
        await deleteManyCommand(payload, args, outputOpts)
        break

      case 'globals':
        await globalsCommand(payload, args, outputOpts)
        break

      case 'get-global':
        await getGlobalCommand(payload, args, outputOpts)
        break

      case 'update-global':
        await updateGlobalCommand(payload, args, outputOpts)
        break

      case 'copy-locale':
        await copyLocaleCommand(payload, args, outputOpts)
        break

      case 'copy-locale-global':
        await copyLocaleGlobalCommand(payload, args, outputOpts)
        break

      case 'upload':
        await uploadCommand(payload, args, outputOpts)
        break

      case 'download':
        await downloadCommand(payload, args, outputOpts)
        break

      case 'status':
        await statusCommand(payload, args, outputOpts)
        break

      default: {
        console.error(`Unknown command: '${command}'`)
        // Suggest similar commands
        const commands = [
          'collections',
          'describe',
          'find',
          'find-by-id',
          'create',
          'update',
          'update-many',
          'delete',
          'delete-many',
          'upload',
          'download',
          'globals',
          'get-global',
          'update-global',
          'copy-locale',
          'copy-locale-global',
          'status',
        ]
        const { suggestField } = await import('./output/errors.js')
        const suggestion = suggestField(command, commands)
        if (suggestion) {
          console.error(`Did you mean '${suggestion}'?`)
        }
        console.error("Run 'payload-agent --help' to see all commands.")
        process.exit(1)
      }
    }
  } finally {
    await shutdownPayload()
    // Force exit - Payload/DB adapters may keep event loop alive
    process.exit(0)
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
