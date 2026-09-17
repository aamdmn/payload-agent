import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), "payload-agent-pack-"));
const tarball = path.join(directory, "package.tgz");
const specPattern = /(^|\/)[^/]*\.spec\.[^/]*/;
const metadataPattern =
  /^package\/(package\.json|README(?:\.[^/]+)?|LICENSE(?:\.[^/]+)?|CHANGELOG(?:\.[^/]+)?)$/;

try {
  execFileSync("pnpm", ["pack", "--out", tarball], {
    cwd: root,
    stdio: "pipe",
  });
  const entries = execFileSync("tar", ["-tzf", tarball], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  const unexpected = entries.filter((entry) => {
    if (specPattern.test(entry) || entry.split("/").includes("..")) {
      return true;
    }
    return !(
      entry === "package/" ||
      entry.startsWith("package/dist/") ||
      metadataPattern.test(entry)
    );
  });

  if (unexpected.length > 0) {
    throw new Error(`Unexpected packed entries:\n${unexpected.join("\n")}`);
  }
  if (
    !entries.some(
      (entry) => entry.startsWith("package/dist/") && !entry.endsWith("/")
    )
  ) {
    throw new Error("No dist files in the package. Run pnpm build first.");
  }
  console.info(`Package check passed (${entries.length} entries).`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
