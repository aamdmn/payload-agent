# payload-agent Command Reference

## payload-agent collections

List all collections in the Payload instance.

```bash
payload-agent collections          # Human-readable table
payload-agent collections --json   # JSON array with metadata
```

Output includes: slug, field count, whether it has auth or upload.

---

## payload-agent describe <collection|global>

Show the full schema for a collection or global. This is the most important command for agents -- always run it before creating or updating data.

```bash
payload-agent describe posts          # Human-readable field tree
payload-agent describe posts --json   # Structured JSON with full field metadata
```

Output includes for each field:
- Name and type
- Required / optional
- Whether it has a default value
- Localized flag
- Relationship targets
- Select/radio options
- Array/block sub-fields
- Description (if set)

---

## payload-agent find <collection>

Query documents in a collection.

```bash
payload-agent find posts
payload-agent find posts --limit 10 --page 2
payload-agent find posts --where '{"status":{"equals":"published"}}'
payload-agent find posts --sort '-createdAt'                          # Descending
payload-agent find posts --select '{"title":true,"slug":true}'        # Only specific fields
payload-agent find posts --depth 2                                    # Populate relationships 2 levels deep
```

### Flags
| Flag | Type | Description |
|------|------|-------------|
| `--where` | JSON string | Payload where query |
| `--limit` | number | Max documents per page (default: 10) |
| `--page` | number | Page number |
| `--sort` | string | Field to sort by. Prefix with `-` for descending |
| `--select` | JSON string | Fields to include: `{"field":true}` |
| `--depth` | number | Relationship population depth |

---

## payload-agent find-by-id <collection> <id>

Fetch a single document by its ID.

```bash
payload-agent find-by-id posts 507f1f77bcf86cd799439011
payload-agent find-by-id posts 507f1f77bcf86cd799439011 --depth 2
```

---

## payload-agent create <collection> --data '{...}'

Create a new document.

```bash
payload-agent create posts --data '{"title":"Hello World","status":"draft"}'
payload-agent create posts --data '{"title":"Test"}' --dry-run    # Validate only
```

Returns the created document (with its generated ID).

---

## payload-agent update <collection> <id> --data '{...}'

Update a single document. Only the fields in `--data` are changed (partial update).

```bash
payload-agent update posts 507f1f77bcf86cd799439011 --data '{"status":"published"}'
```

---

## payload-agent update-many <collection> --where '{...}' --data '{...}'

Bulk update documents matching a query. Requires `--where` to prevent accidental mass updates.

```bash
payload-agent update-many posts --where '{"status":{"equals":"draft"}}' --data '{"status":"published"}'
payload-agent update-many posts --where '{"status":{"equals":"draft"}}' --data '{"status":"published"}' --dry-run
```

---

## payload-agent delete <collection> <id>

Delete a single document. Shows a preview by default. Add `--confirm` to execute.

```bash
payload-agent delete posts 507f1f77bcf86cd799439011            # Preview
payload-agent delete posts 507f1f77bcf86cd799439011 --confirm  # Execute
```

---

## payload-agent delete-many <collection> --where '{...}'

Bulk delete documents. Requires `--where` and `--confirm`.

```bash
payload-agent delete-many posts --where '{"status":{"equals":"archived"}}'            # Preview
payload-agent delete-many posts --where '{"status":{"equals":"archived"}}' --confirm  # Execute
```

---

## payload-agent globals

List all globals.

```bash
payload-agent globals
payload-agent globals --json
```

---

## payload-agent get-global <slug>

Read a global's data.

```bash
payload-agent get-global site-settings
payload-agent get-global site-settings --json
```

---

## payload-agent update-global <slug> --data '{...}'

Update a global. Partial update -- only fields in `--data` are changed.

```bash
payload-agent update-global site-settings --data '{"siteName":"New Name"}'
```

---

## payload-agent status

Show Payload instance status: connection, collections, globals, localization.

```bash
payload-agent status
payload-agent status --json
```
