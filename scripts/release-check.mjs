#!/usr/bin/env node
/**
 * Release gate: verifies that the package version, VERSION file, tag, changelog, docs and metadata
 * agree. Run locally before tagging; CI and the release workflow run the same script.
 *
 * Usage: node scripts/release-check.mjs [--tag vX.Y.Z]
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const tagIndex = args.indexOf("--tag");
const tagArg = tagIndex >= 0 ? args[tagIndex + 1] : process.env.GITHUB_REF_NAME;
const errors = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const version = read("VERSION").trim();
const pkg = JSON.parse(read("package.json"));

if (pkg.version !== version) {
  errors.push(`package.json version ${pkg.version} does not match VERSION ${version}`);
}
const tag = tagArg || `v${version}`;
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  errors.push(`tag must look like vX.Y.Z (got ${tag})`);
}
if (tag !== `v${version}`) {
  errors.push(`tag ${tag} does not match version v${version}`);
}

const changelog = read("CHANGELOG.md");
if (!new RegExp(`^##\\s+${escape(version)}(?:\\s|$)`, "m").test(changelog)) {
  errors.push(`CHANGELOG.md has no section for ${version}`);
}

const requiredFiles = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "docs/index.md",
  "docs/getting-started.md",
  "docs/versioning.md",
  "docs/releasing.md",
  "docs/.vitepress/config.mts",
  "rules/instructions/versioning.md",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`missing required file: ${file}`);
}

if (pkg.license !== "MIT") errors.push(`package.json license must be MIT (got ${pkg.license})`);
if (!pkg.repository?.url) errors.push("package.json repository.url is missing");
if (!pkg.homepage) errors.push("package.json homepage is missing");
if (pkg.engines?.node !== ">=22.5") errors.push("package.json engines.node must be >=22.5");

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  console.error(`\nrelease check failed: ${errors.length} error(s)`);
  process.exit(1);
}
console.log(`release check passed for v${version} (tag ${tag})`);
