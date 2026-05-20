#!/usr/bin/env node

/**
 * Docs Path Checker for CI
 *
 * Verifies that every relative link in `packages/sdk/docs/**\/*.md` resolves
 * to a path inside `packages/sdk/docs/`. Only that directory is published to
 * https://docs.tailor.tech, so links pointing outside (e.g. `../../../example/foo.ts`)
 * render fine on GitHub but 404 on the docs site.
 *
 * The existing lychee link-check only verifies that a target file exists on
 * disk, so it happily accepts escape paths as long as the file is in the
 * repository. This script fills that gap.
 *
 * Usage:
 *   node scripts/check-docs-paths.js
 *
 * Exit codes:
 *   0 - All relative links stay within packages/sdk/docs/
 *   1 - Found one or more links escaping packages/sdk/docs/
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(scriptDir, "..");
const DOCS_ROOT = resolve(REPO_ROOT, "packages/sdk/docs");

/**
 * Recursively collect all `.md` files under `dir`.
 */
async function collectMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Blank out fenced code blocks and inline code, preserving newlines so line
 * numbers in error messages stay accurate.
 */
function stripCode(content) {
  return content
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => m.replace(/[^\n]/g, " "));
}

// Matches markdown links `[text](url)` and images `![alt](url)`.
// Allows an optional title: `[text](url "title")`.
const LINK_RE = /!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/g;
// Schemes like http:, https:, mailto:, tel:, data:
const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Find relative links in `content` that escape `docsRoot`.
 *
 * @param {string} file - Absolute path to the markdown file.
 * @param {string} content - Raw markdown content.
 * @param {string} [docsRoot] - Absolute path to the docs root directory.
 * @param {string} [repoRoot] - Absolute path to the repository root.
 * @returns {{file: string, line: number, url: string, resolved: string}[]}
 */
function findEscapingLinks(file, content, docsRoot = DOCS_ROOT, repoRoot = REPO_ROOT) {
  const stripped = stripCode(content);
  const errors = [];
  const lines = stripped.split("\n");

  lines.forEach((line, idx) => {
    for (const match of line.matchAll(LINK_RE)) {
      let url = match[1];
      // Drop anchor component (`foo.md#section` -> `foo.md`)
      const hashIdx = url.indexOf("#");
      if (hashIdx >= 0) url = url.slice(0, hashIdx);
      if (!url) continue;
      if (EXTERNAL_SCHEME_RE.test(url)) continue;
      // Site-absolute paths (`/something`) target the docs site root, not the
      // filesystem. Skip them: verifying site-root layout is out of scope here.
      if (url.startsWith("/")) continue;

      const resolved = resolve(dirname(file), url);
      const rel = relative(docsRoot, resolved);
      // `rel` starts with `..` when `resolved` is outside docsRoot.
      // On different drives (Windows), `relative` can return an absolute path
      // — treat that as an escape too.
      if (rel.startsWith("..") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) {
        errors.push({
          file: relative(repoRoot, file),
          line: idx + 1,
          url: match[1],
          resolved: relative(repoRoot, resolved),
        });
      }
    }
  });

  return errors;
}

async function main() {
  const files = await collectMarkdownFiles(DOCS_ROOT);
  const allErrors = [];

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    allErrors.push(...findEscapingLinks(file, content));
  }

  if (allErrors.length > 0) {
    const isCI = process.env.CI === "true";
    console.error(`Found ${allErrors.length} relative link(s) escaping packages/sdk/docs/:\n`);
    for (const err of allErrors) {
      console.error(`  ${err.file}:${err.line}: "${err.url}" -> ${err.resolved}`);
      if (isCI) {
        // GitHub Actions annotation — shows inline on the PR diff.
        const msg = `Relative link "${err.url}" escapes packages/sdk/docs/ and will 404 on docs.tailor.tech. Use a GitHub absolute URL instead.`;
        console.log(`::error file=${err.file},line=${err.line}::${msg}`);
      }
    }
    console.error(
      `\nOnly packages/sdk/docs/ is published to https://docs.tailor.tech,` +
        ` so these links will 404 on the docs site.`,
    );
    console.error(
      `\nFix: either move the target into packages/sdk/docs/, or replace` +
        ` the link with a GitHub absolute URL, e.g.`,
    );
    console.error(`  https://github.com/tailor-platform/sdk/blob/main/example/foo.ts`);
    process.exit(1);
  }

  console.log(
    `Checked ${files.length} file(s) under packages/sdk/docs/: no relative links escape the directory.`,
  );
}

export { stripCode, findEscapingLinks, collectMarkdownFiles };

// Run as CLI when invoked directly (not imported as a module).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
