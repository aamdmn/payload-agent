<div align='center'>
    <br/>
    <br/>
    <h3>payload-agent</h3>
    <p>PayloadCMS automation CLI for AI agents</p>
    <br/>
    <br/>
</div>

Direct database access to PayloadCMS through the Local API. No server, no API keys, no MCP. Just commands.

Built for AI coding agents (Opencode, Claude Code, etc.) but works great for humans too.

## Quick Start

```bash
cd your-payload-project
npx payload-agent collections                  # discover
npx payload-agent describe posts               # understand schema
npx payload-agent describe posts --examples    # see JSON field structures
npx payload-agent find posts --limit 5         # read
npx payload-agent create posts --data '{"title":"Hello"}' # write
```

Or point at a config directly:

```bash
npx payload-agent find posts --config ./src/payload.config.ts
```

## Commands

| Command                                      | Description                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `collections`                                | List all collections                                                    |
| `globals`                                    | List all globals                                                        |
| `describe <name> [--examples]`               | Show full schema (with sample JSON field structures)                    |
| `status`                                     | Instance status                                                         |
| `find <collection>`                          | Query documents (`--where`, `--limit`, `--sort`, `--select`, `--depth`) |
| `find-by-id <collection> <id>`               | Get a single document                                                   |
| `create <collection> --data '{...}'`         | Create a document                                                       |
| `update <collection> <id> --data '{...}'`    | Partial update                                                          |
| `update-many <collection> --where --data`    | Bulk update                                                             |
| `delete <collection> <id> --confirm`         | Delete (previews first)                                                 |
| `delete-many <collection> --where --confirm` | Bulk delete                                                             |
| `upload <collection> <file\|dir>`            | Upload file(s) to an upload collection                                  |
| `download <collection> <id\|--where>`        | Download media to disk                                                  |
| `get-global <slug>`                          | Read a global                                                           |
| `update-global <slug> --data '{...}'`        | Update a global                                                         |

## Media

Upload, download, and attach files to documents:

```bash
# Upload
payload-agent upload media ./hero.jpg --data '{"alt":"Hero image"}'
payload-agent upload media ./photos/             # bulk upload directory

# Download
payload-agent download media 6789abc --out ./downloads/
payload-agent download media --where '{"alt":{"contains":"hero"}}'

# Auto-upload and attach to a document field
payload-agent create pages --data '{"title":"About"}' --file 'heroImage=./hero.jpg'
payload-agent update pages <id> --data '{}' --file 'thumbnail=./thumb.png'
```

The `--file` flag auto-detects the target upload collection from the field schema, uploads the file, and injects the resulting ID.

## Flags

| Flag                       | Description                                                                |
| -------------------------- | -------------------------------------------------------------------------- |
| `--json`                   | Machine-readable JSON output                                               |
| `--dry-run`                | Validate without writing                                                   |
| `--confirm`                | Confirm destructive operations                                             |
| `--config <path>`          | Path to `payload.config.ts`                                                |
| `--locale <code>`          | Locale for reading/writing localized fields (use `all` to see all locales) |
| `--fallback-locale <code>` | Fallback locale for reads (use `none` to disable)                          |
| `--file 'field=./path'`    | Upload and attach file to a field                                          |
| `--data @file.json`        | Read `--data` JSON from a file instead of inline                           |
| `--examples`               | Show example values for `json` fields (use with `describe`)                |
| `--include-sensitive`      | Include password hashes, API keys, etc.                                    |

## How It Works

```
payload-agent find posts --limit 5
       |
       v
  Import your payload.config.ts
  Initialize Payload Local API
  payload.find({ collection: 'posts', limit: 5 })
  Output result
```

No HTTP server needed. Connects directly to your database through Payload's own Local API.

## Agent Skill

The `skills/` directory contains a [Claude Code skill](https://claude.ai/docs/skills) that teaches agents the discover-describe-read-write-verify workflow:

```bash
# Agents learn to:
# 1. payload-agent collections              -> what exists?
# 2. payload-agent describe posts           -> what fields?
# 3. payload-agent describe posts --examples -> what shape are json fields?
# 4. payload-agent find posts               -> what data?
# 5. payload-agent create posts --data      -> write
# 6. payload-agent find-by-id posts         -> verify
```

## Requirements

- Node.js ^18.20.2 or >=20.9.0
- Payload CMS ^3.0.0

## License

MIT
