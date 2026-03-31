# Schema Discovery Workflow

The most common mistake agents make is trying to create or update data without first understanding the schema. This document describes the correct workflow.

## Step 1: List Collections

```bash
payload-agent collections
```

This shows you all available collections, how many fields they have, and whether they support auth or file uploads.

## Step 2: Describe the Target Collection

```bash
payload-agent describe posts
```

This is the critical step. The output shows:

```
Collection: posts
Flags: timestamps

Fields:
  id: text (auto-generated)
  createdAt: date (auto-generated)
  updatedAt: date (auto-generated)
  title: text (required)
  body: richText
  slug: text
  status: select [draft, published, archived] (has default)
  author: relationship -> users
  tags: array
    tag: text
```

From this you learn:
- `title` is **required** -- you must include it in every create
- `status` has a **default** -- you can omit it and it defaults to "draft"
- `author` is a **relationship** to the `users` collection -- pass a user ID
- `tags` is an **array** of objects with a `tag` text field
- `id`, `createdAt`, `updatedAt` are **auto-generated** -- never set them manually

### JSON fields: use `--examples`

If the schema contains `json` type fields (custom editors, table data, config objects), the `describe` output only shows `json` as the type -- it can't tell you the expected shape. Use `--examples` to sample a real document and see the structure:

```bash
payload-agent describe products --examples
```

This adds an `Example:` line below each json field showing the actual data shape:

```
data: json (localized) "Table Data (JSON)"
  Example: { headers: ["Size", ...], rows: [["S", "69-69", ...], ...] }
```

This is especially useful for fields that use custom UI components (size table editors, config builders, etc.) where the schema alone doesn't reveal the expected format.

## Step 3: Read Sample Data

```bash
payload-agent find posts --limit 3
```

Looking at existing documents helps you understand the data format, especially for complex fields like rich text, arrays, and relationships.

## Step 4: Write Data

Now you have enough context to write data correctly:

```bash
payload-agent create posts --data '{"title":"My Post","slug":"my-post","status":"published"}'
```

## Common Schema Pitfalls

### Required Fields
If you get a validation error about missing fields, run `payload-agent describe` again and look for fields marked `(required)`.

### Relationship Fields
Relationship fields expect an ID (string), not an object. Find the related document's ID first:
```bash
payload-agent find users --select '{"id":true,"email":true}' --limit 5
```

### Select/Radio Fields
These fields only accept specific values. The allowed values are shown in the `describe` output:
```
status: select [draft, published, archived]
```

### Array Fields
Array fields expect an array of objects with the sub-fields:
```json
{"tags": [{"tag": "science"}, {"tag": "nature"}]}
```

### Rich Text Fields
Rich text fields use Lexical editor format. Check existing documents to see the format:
```bash
payload-agent find-by-id posts <id> --json
```
