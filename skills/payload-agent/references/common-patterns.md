# Common Patterns & Recipes

## Content Creation Pipeline

```bash
# 1. Discover and understand
payload-agent collections
payload-agent describe posts

# 2. Create draft content
payload-agent create posts --data '{"title":"New Article","slug":"new-article","status":"draft"}'

# 3. Verify creation
payload-agent find posts --where '{"slug":{"equals":"new-article"}}' --select '{"id":true,"title":true,"status":true}'

# 4. Publish when ready
payload-agent update posts <id> --data '{"status":"published"}'
```

## Bulk Status Update

```bash
# Preview what will change
payload-agent find posts --where '{"status":{"equals":"draft"}}' --select '{"id":true,"title":true}'

# Dry run the update
payload-agent update-many posts --where '{"status":{"equals":"draft"}}' --data '{"status":"published"}' --dry-run

# Execute
payload-agent update-many posts --where '{"status":{"equals":"draft"}}' --data '{"status":"published"}'
```

## Search and Modify

```bash
# Find documents matching criteria
payload-agent find posts --where '{"title":{"contains":"old keyword"}}' --json

# Update each one (or use update-many for uniform changes)
payload-agent update posts <id1> --data '{"title":"New Title 1"}'
payload-agent update posts <id2> --data '{"title":"New Title 2"}'
```

## Safe Cleanup

```bash
# Step 1: Preview what will be deleted
payload-agent delete-many posts --where '{"status":{"equals":"archived"}}'

# Step 2: Verify the list is correct
# Step 3: Confirm deletion
payload-agent delete-many posts --where '{"status":{"equals":"archived"}}' --confirm
```

## Working with Globals

```bash
# Read current settings
payload-agent get-global site-settings

# Update a specific field
payload-agent update-global site-settings --data '{"maintenanceMode":true}'

# Verify
payload-agent get-global site-settings --select '{"maintenanceMode":true}'
```

## JSON Output for Scripting

```bash
# Get document IDs as JSON
payload-agent find posts --select '{"id":true}' --json | jq '.[].id'

# Count documents
payload-agent find posts --where '{"status":{"equals":"published"}}' --json | jq '.totalDocs'

# Chain commands
ID=$(payload-agent create posts --data '{"title":"Test"}' --json | jq -r '.id')
payload-agent find-by-id posts "$ID"
```

## Media Upload Pipeline

```bash
# 1. Check which collections support uploads
payload-agent collections

# 2. Understand the media schema (alt text, etc.)
payload-agent describe media

# 3. Upload a single file
payload-agent upload media ./hero.jpg --data '{"alt":"Hero banner image"}'

# 4. Bulk upload a directory
payload-agent upload media ./photos/

# 5. Verify uploads
payload-agent find media --limit 5 --select '{"id":true,"filename":true,"alt":true}'
```

## Creating Content with Images

```bash
# Describe the target collection to find upload fields
payload-agent describe pages

# Create a page with an auto-uploaded hero image
payload-agent create pages --data '{"title":"About Us","slug":"about"}' --file 'heroImage=./hero.jpg'

# Create with multiple file fields
payload-agent create pages --data '{"title":"Gallery"}' --file 'heroImage=./hero.jpg' --file 'thumbnail=./thumb.png'

# Upload separately, then reference by ID
payload-agent upload media ./hero.jpg --json   # Get the ID from output
payload-agent create pages --data '{"title":"About","heroImage":"<media-id>"}'
```

## Download Media

```bash
# Download a specific file
payload-agent download media <id> --out ./downloads/

# Download all images matching a query
payload-agent download media --where '{"mimeType":{"contains":"image"}}' --out ./backups/

# Dry run to see what would be downloaded
payload-agent download media --where '{"alt":{"contains":"hero"}}' --dry-run
```

## Data Inspection

```bash
# Quick overview of a collection
payload-agent find posts --limit 3 --select '{"id":true,"title":true,"status":true,"createdAt":true}'

# Full document inspection
payload-agent find-by-id posts <id> --json --depth 2

# Check relationships
payload-agent find posts --where '{"author":{"equals":"<user-id>"}}' --select '{"title":true}'
```
