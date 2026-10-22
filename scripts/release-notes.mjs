#!/usr/bin/env node
/**
 * Extracts the changelog section for a release and writes release notes with install instructions.
 *
 * Usage: node scripts/release-notes.mjs [--tag vX.Y.Z] [--out release-notes.md]
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const get = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const tag = get("--tag", process.env.GITHUB_REF_NAME);
if (!tag) {
  console.error("usage: node scripts/release-notes.mjs --tag vX.Y.Z [--out file]");
  process.exit(2);
}
const version = tag.replace(/^v/, "");
const out = get("--out");

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex((line) => new RegExp(`^##\\s+${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(line));
if (start === -1) {
  console.error(`no CHANGELOG section for ${version}`);
  process.exit(1);
}
let end = lines.length;
for (let i = start + 1; i < lines.length; i += 1) {
  if (/^##\s+/.test(lines[i])) {
    end = i;
    break;
  }
}
const section = lines.slice(start, end).join("\n").trim();

const notes = [
  `# AgentOps Rules ${tag}`,
  "",
  section,
  "",
  "## Install",
  "",
  "```powershell",
  "gh release download " + tag + " --repo J-Akiru5/agentops-rules --pattern \"agentops-rules.zip*\"",
  "Expand-Archive .\\agentops-rules.zip .\\agentops-rules -Force",
  "node .\\agentops-rules\\install.mjs",
  "```",
  "",
  "Verify the SHA256 checksum before installing. Full docs: https://j-akiru5.github.io/agentops-rules/",
  "",
].join("\n");

if (out) {
  fs.writeFileSync(path.resolve(root, out), notes, "utf8");
  console.log(`release notes written: ${out}`);
} else {
  process.stdout.write(notes);
}
