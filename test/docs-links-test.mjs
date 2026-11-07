import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const files = execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

// Markdown inline links/images only: [text](target) and ![alt](target).
const LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const missing = [];
let checked = 0;

for (const file of files) {
  const body = readFileSync(resolve(root, file), "utf8");
  for (const match of body.matchAll(LINK)) {
    const target = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue; // external, protocol-relative, anchor
    const path = resolve(root, dirname(file), decodeURIComponent(target.split("#")[0]));
    if (!path.startsWith(root)) {
      missing.push({ file, target, reason: "outside the repository" });
      continue;
    }
    checked += 1;
    if (!existsSync(path)) missing.push({ file, target, reason: "missing file" });
  }
}

assert.deepEqual(missing, [], `broken relative links:\n${JSON.stringify(missing, null, 2)}`);
console.log(JSON.stringify({ files: files.length, relativeLinks: checked, status: "passed" }, null, 2));
