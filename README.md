# payload-agent

PayloadCMS CLI for AI agents and humans. Simple, direct access to your CMS data.

No plugins. No MCP. No protocol overhead. Just commands.

## How It Works

`payload-agent` uses Payload's Local API to connect directly to your database. Point it at any Payload project's `payload.config.ts` and run commands.

```bash
# From inside a Payload project directory
payload-agent collections
payload-agent describe posts
payload-agent find posts --limit 5
payload-agent create posts --data '{"title":"Hello World"}'
```

## Usage

### Option 1: From a Payload project directory

If your working directory contains a `payload.config.ts` (or `src/payload.config.ts`), payload-agent will find it automatically:

```bash
cd /path/to/your-payload-project
npx payload-agent collections
```

### Option 2: Point at a config file

```bash
npx payload-agent collections --config /path/to/payload.config.ts
```

### Option 3: Environment variable

```bash
export PAYLOAD_CONFIG_PATH=/path/to/payload.config.ts
npx payload-agent collections
```

## Development

### Testing against a real Payload project

During development, use `pnpm payload-agent` from this repo and point at any Payload project:

```bash
# From this repo
PAYLOAD_CONFIG_PATH=/path/to/your-payload-project/payload.config.ts pnpm payload-agent collections
PAYLOAD_CONFIG_PATH=/path/to/your-payload-project/payload.config.ts pnpm payload-agent describe posts
PAYLOAD_CONFIG_PATH=/path/to/your-payload-project/payload.config.ts pnpm payload-agent find posts --limit 5
```

Or set it once for the session:

```bash
export PAYLOAD_CONFIG_PATH=/path/to/your-payload-project/payload.config.ts
pnpm payload-agent collections
pnpm payload-agent describe posts
pnpm payload-agent find posts --limit 5
```

### Commands

Run `pnpm payload-agent --help` for the full command reference.

**Introspection:**
- `payload-agent collections` -- List all collections
- `payload-agent describe <collection|global>` -- Show full schema
- `payload-agent globals` -- List all globals
- `payload-agent status` -- Instance status

**Read:**
- `payload-agent find <collection>` -- Query documents
- `payload-agent find-by-id <collection> <id>` -- Get a document
- `payload-agent get-global <slug>` -- Read a global

**Write:**
- `payload-agent create <collection> --data '{...}'` -- Create a document
- `payload-agent update <collection> <id> --data '{...}'` -- Update a document
- `payload-agent update-many <collection> --where '{...}' --data '{...}'` -- Bulk update
- `payload-agent update-global <slug> --data '{...}'` -- Update a global

**Delete (requires `--confirm`):**
- `payload-agent delete <collection> <id>` -- Delete a document
- `payload-agent delete-many <collection> --where '{...}'` -- Bulk delete

### Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output |
| `--dry-run` | Validate without writing |
| `--confirm` | Confirm destructive operations |
| `--config <path>` | Path to payload.config.ts |
| `--include-sensitive` | Show sensitive fields |

## For AI Agents

Install the skill so your agent knows how to use payload-agent:

```bash
# The skill teaches agents the workflow:
# discover -> describe -> read -> write -> verify
```

See `skills/payload-agent/SKILL.md` for the full agent instruction document.

## Architecture

```
Agent types: payload-agent find posts --limit 5
    |
    v
payload-agent CLI (Node.js)
    |
    1. Find payload.config.ts
    2. Initialize Payload Local API (connects to your DB)
    3. Execute: payload.find({ collection: 'posts', limit: 5 })
    4. Output result
    |
    v
Agent reads output, continues work
```

No HTTP server. No API keys. No MCP protocol. Direct database access through Payload's own Local API.
