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
| `--locale` | string | Locale code (e.g. `sk`, `cz`, `all`) |
| `--fallback-locale` | string | Fallback locale for reads (use `none` to disable) |

---

## payload-agent find-by-id <collection> <id>

Fetch a single document by its ID.

```bash
payload-agent find-by-id posts 507f1f77bcf86cd799439011
payload-agent find-by-id posts 507f1f77bcf86cd799439011 --depth 2
payload-agent find-by-id posts 507f1f77bcf86cd799439011 --locale all   # See all locale values
payload-agent find-by-id posts 507f1f77bcf86cd799439011 --locale fr --fallback-locale none  # See untranslated fields as null
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

## payload-agent upload <collection> <file|dir>

Upload file(s) to an upload-enabled collection. Supports single files, multiple files, and directories.

```bash
payload-agent upload media ./hero.jpg
payload-agent upload media ./hero.jpg --data '{"alt":"Hero image"}'
payload-agent upload media ./photos/                    # All files in directory
payload-agent upload media ./img1.jpg ./img2.png        # Multiple files
payload-agent upload media ./hero.jpg --dry-run         # Preview only
```

### Flags
| Flag | Type | Description |
|------|------|-------------|
| `--data` | JSON string | Metadata for the uploaded file (alt text, etc.) |
| `--dry-run` | boolean | List files that would be uploaded without executing |

The collection must be upload-enabled (has `upload` config). Run `payload-agent collections` to see which collections support uploads.

For bulk uploads, a progress summary is shown. If any file fails, the rest still proceed.

---

## payload-agent download <collection> <id>

Download file(s) from an upload-enabled collection to local disk.

```bash
payload-agent download media 507f1f77bcf86cd799439011
payload-agent download media 507f1f77bcf86cd799439011 --out ./downloads/
payload-agent download media --where '{"alt":{"contains":"hero"}}' --out ./images/
payload-agent download media --where '{"mimeType":{"contains":"image"}}' --limit 50
```

### Flags
| Flag | Type | Description |
|------|------|-------------|
| `--out` | path | Output directory (default: current directory) |
| `--where` | JSON string | Query to select multiple files for download |
| `--limit` | number | Max documents when using --where (default: 100) |
| `--dry-run` | boolean | List files that would be downloaded without executing |

Files are fetched via their URL. If the URL is relative, `serverURL` from the Payload config is prepended. Works with both local storage and cloud storage (S3, etc.).

---

## payload-agent create/update with --file

The `create` and `update` commands support `--file` flags to automatically upload files and inject their IDs into document data.

```bash
# Upload hero.jpg to the media collection and set it as the heroImage field
payload-agent create pages --data '{"title":"About"}' --file 'heroImage=./hero.jpg'

# Multiple files for different fields
payload-agent create pages --data '{"title":"About"}' --file 'heroImage=./hero.jpg' --file 'thumbnail=./thumb.png'

# Works with nested/dot-path fields (arrays, blocks, groups)
payload-agent update pages <id> --data '{}' --file 'layout.0.image=./photo.jpg'
```

The `--file` flag format is `fieldPath=./filePath`. The target upload collection is auto-detected from the field's schema (`relationTo`). The file is uploaded first, then the resulting document ID is injected into the data at the specified field path.

---

## payload-agent copy-locale <collection>

Copy all localized field values from one locale to another. Schema-aware -- only copies fields marked `localized: true`.

```bash
# Copy all products from sk to cz
payload-agent copy-locale products --from sk --to cz

# Copy a single document
payload-agent copy-locale products <id> --from sk --to cz

# Copy matching documents
payload-agent copy-locale products --from sk --to cz --where '{"_status":{"equals":"published"}}'

# Dry run: see what would be copied
payload-agent copy-locale products --from sk --to cz --dry-run
```

### Flags
| Flag | Type | Description |
|------|------|-------------|
| `--from` | string | Source locale (required) |
| `--to` | string | Target locale (required) |
| `--where` | JSON string | Filter which documents to copy |
| `--dry-run` | boolean | Preview without writing |

---

## payload-agent copy-locale-global <slug>

Copy localized field values between locales for a global.

```bash
payload-agent copy-locale-global header --from sk --to cz
payload-agent copy-locale-global footer --from sk --to cz --dry-run
```

---

## payload-agent status

Show Payload instance status: connection, collections, globals, localization (with locale codes).

```bash
payload-agent status
payload-agent status --json
```
