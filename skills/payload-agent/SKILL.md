---
name: payload-agent
description: PayloadCMS CLI for AI agents. Use when the user needs to create, read, update, or delete CMS content, upload/download media files, inspect collection schemas, or manage PayloadCMS data from the command line.
allowed-tools: Bash(npx payload-agent:*), Bash(payload-agent:*), Bash(pnpm payload-agent:*)
---

# payload-agent - PayloadCMS CLI for Agents

A command-line tool that gives you direct access to PayloadCMS data. No MCP, no protocol overhead. Just commands.

## Core Workflow

Always follow this pattern when working with PayloadCMS data:

```bash
# 1. DISCOVER what collections exist
payload-agent collections

# 2. UNDERSTAND the schema before writing
payload-agent describe posts
payload-agent describe posts --examples   # see json field shapes

# 3. READ existing data
payload-agent find posts --limit 5

# 4. WRITE data
payload-agent create posts --data '{"title": "My Post", "status": "draft"}'

# 5. VERIFY your changes
payload-agent find-by-id posts <id>
```

## Rules

1. **ALWAYS run `payload-agent describe <collection>` before creating or updating documents.** This shows you all fields, their types, which are required, and what values are accepted. Use `--examples` to see the expected structure of `json` fields (custom editors, tables, etc.).

2. **ALWAYS preview destructive operations.** `payload-agent delete` and `payload-agent delete-many` show a preview by default. Only add `--confirm` after verifying the preview.

3. **Use `--json` when you need to parse output programmatically.** Human-readable output is the default.

4. **Use `--select` to limit returned fields** when you only need specific data. This reduces output size.

5. **Use `--dry-run` for write operations** when you want to validate data without persisting it.

## Command Reference

### Introspection

```bash
payload-agent collections                          # List all collections
payload-agent describe <collection|global>         # Show full schema
payload-agent describe <collection> --examples     # Show schema + example json field structures
payload-agent globals                              # List all globals
payload-agent status                               # Show instance status
```

### Reading Data

```bash
# Find documents with optional filtering
payload-agent find <collection> [--where '{"field":{"operator":"value"}}'] [--limit N] [--page N] [--sort field] [--select '{"field":true}'] [--depth N]

# Find a specific document
payload-agent find-by-id <collection> <id> [--depth N] [--select '...']

# Read a global
payload-agent get-global <slug> [--depth N] [--select '...']
```

### Writing Data

```bash
# Create a document
payload-agent create <collection> --data '{"field":"value"}' [--dry-run]

# Create with file upload (auto-uploads file and injects ID)
payload-agent create <collection> --data '{"title":"About"}' --file 'heroImage=./hero.jpg'

# Update a single document
payload-agent update <collection> <id> --data '{"field":"new value"}' [--dry-run]

# Update with file upload
payload-agent update <collection> <id> --data '{}' --file 'heroImage=./new-hero.jpg'

# Update multiple documents
payload-agent update-many <collection> --where '{"field":{"equals":"value"}}' --data '{"field":"new value"}' [--dry-run]

# Update a global
payload-agent update-global <slug> --data '{"field":"value"}' [--dry-run]
```

### Media (Upload / Download)

```bash
# Upload a file to an upload-enabled collection
payload-agent upload <collection> <file|dir> [--data '{"alt":"..."}'] [--dry-run]

# Upload multiple files
payload-agent upload <collection> ./file1.jpg ./file2.png

# Upload all files in a directory
payload-agent upload <collection> ./photos/

# Download a file by ID
payload-agent download <collection> <id> [--out ./path/]

# Download files matching a query
payload-agent download <collection> --where '{"alt":{"contains":"hero"}}' [--out ./path/]
```

### Deleting Data (requires --confirm)

```bash
# Delete a single document (preview first, then confirm)
payload-agent delete <collection> <id>              # Shows preview
payload-agent delete <collection> <id> --confirm    # Executes delete

# Delete multiple documents
payload-agent delete-many <collection> --where '{"status":{"equals":"draft"}}'            # Shows preview
payload-agent delete-many <collection> --where '{"status":{"equals":"draft"}}' --confirm  # Executes delete
```

### Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON for machine parsing |
| `--dry-run` | Validate without executing writes |
| `--confirm` | Confirm destructive operations |
| `--config <path>` | Path to payload.config.ts |
| `--include-sensitive` | Include sensitive fields in output |

## Where Clause Syntax

The `--where` flag uses Payload's query syntax as JSON:

```bash
# Equals
--where '{"status":{"equals":"published"}}'

# Not equals
--where '{"status":{"not_equals":"draft"}}'

# Greater than
--where '{"createdAt":{"greater_than":"2024-01-01"}}'

# Contains (text search)
--where '{"title":{"contains":"hello"}}'

# AND (multiple conditions)
--where '{"and":[{"status":{"equals":"published"}},{"title":{"contains":"hello"}}]}'

# OR
--where '{"or":[{"status":{"equals":"draft"}},{"status":{"equals":"archived"}}]}'
```

## Common Patterns

### Create a blog post
```bash
payload-agent describe posts                       # Check required fields
payload-agent create posts --data '{"title":"My New Post","status":"draft","slug":"my-new-post"}'
```

### Find and update a document
```bash
payload-agent find posts --where '{"title":{"contains":"hello"}}' --select '{"id":true,"title":true}'
payload-agent update posts <id> --data '{"status":"published"}'
```

### Bulk publish drafts
```bash
payload-agent find posts --where '{"status":{"equals":"draft"}}' --limit 100   # Preview
payload-agent update-many posts --where '{"status":{"equals":"draft"}}' --data '{"status":"published"}' --dry-run  # Dry run
payload-agent update-many posts --where '{"status":{"equals":"draft"}}' --data '{"status":"published"}'            # Execute
```

### Clean up old content
```bash
payload-agent delete-many posts --where '{"status":{"equals":"archived"}}'            # Preview what will be deleted
payload-agent delete-many posts --where '{"status":{"equals":"archived"}}' --confirm  # Execute after verifying
```

### Upload media and attach to content
```bash
payload-agent describe pages                          # Find upload/relationship fields
payload-agent upload media ./hero.jpg --data '{"alt":"Hero image"}'
payload-agent create pages --data '{"title":"About"}' --file 'heroImage=./hero.jpg'   # Auto-upload + inject
```

### Bulk upload images
```bash
payload-agent upload media ./photos/                  # Upload all files in directory
payload-agent upload media ./img1.jpg ./img2.png      # Upload specific files
```

## Error Handling

payload-agent provides AI-friendly error messages:

- **Unknown field names**: Suggests the closest matching field
- **Missing required fields**: Lists which fields are required
- **Invalid collection**: Shows available collections with suggestions
- **Validation errors**: Tells you exactly what failed and hints at how to fix it

When you see an error, run `payload-agent describe <collection>` to review the schema.

## Output Modes

- **Human mode** (default): Readable tables and formatted output
- **JSON mode** (`--json`): Raw JSON, suitable for piping to `jq` or parsing

Sensitive fields (password hashes, API keys, etc.) are automatically redacted unless `--include-sensitive` is passed.

## Deep-Dive References

- [Full Command Reference](references/commands.md)
- [Schema Discovery Workflow](references/schema-workflow.md)
- [Common Patterns & Recipes](references/common-patterns.md)
