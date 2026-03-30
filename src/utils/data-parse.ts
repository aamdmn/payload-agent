import fs from "node:fs";
import path from "node:path";

/**
 * Parse a --data flag value into a JavaScript object.
 *
 * Supports:
 * - Plain JSON string: '{"title":"Hello"}'
 * - File reference:    '@data.json' (reads file content, then parses as JSON)
 */
export function parseDataFlag(raw: string): Record<string, unknown> {
  let jsonString = raw;

  if (raw.startsWith("@")) {
    const filePath = raw.slice(1);
    const resolved = path.resolve(filePath);

    try {
      jsonString = fs.readFileSync(resolved, "utf-8");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: Could not read data file '${filePath}'.`);
      console.error(`  Resolved path: ${resolved}`);
      console.error(`  ${msg}`);
      process.exit(1);
    }
  }

  try {
    return JSON.parse(jsonString) as Record<string, unknown>;
  } catch {
    console.error("Error: Invalid JSON in --data flag.");
    if (raw.startsWith("@")) {
      console.error(`  File: ${raw.slice(1)}`);
    }
    console.error(
      "  Hint: Ensure the JSON is valid. Use single quotes around the flag value to avoid shell escaping issues."
    );
    process.exit(1);
  }
}
