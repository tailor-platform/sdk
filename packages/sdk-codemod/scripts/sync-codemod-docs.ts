#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMigrationDoc } from "../src/migration-doc";
import { allCodemods } from "../src/registry";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// packages/sdk-codemod/scripts -> packages/sdk/docs/migration/v<major>.md
const docsDir = resolve(scriptDir, "../../sdk/docs/migration");

function parseMode(args: string[]): "write" | "check" {
  const modes = args.filter((arg) => arg === "--check" || arg === "--write");
  if (modes.length !== 1 || modes.length !== args.length) {
    process.stderr.write("Usage: tsx scripts/sync-codemod-docs.ts --check|--write\n");
    process.exit(2);
  }
  return modes[0] === "--write" ? "write" : "check";
}

const mode = parseMode(process.argv.slice(2));
const majors = [...new Set(allCodemods.map((codemod) => Number(codemod.until.split(".")[0])))];

let outdated = false;
for (const major of majors) {
  const codemods = allCodemods.filter((codemod) => Number(codemod.until.split(".")[0]) === major);
  const docPath = resolve(docsDir, `v${major}.md`);
  const expected = renderMigrationDoc(codemods, major);

  if (mode === "write") {
    await writeFile(docPath, expected, "utf-8");
    process.stderr.write(`Wrote ${docPath}\n`);
  } else {
    const actual = await readFile(docPath, "utf-8").catch(() => null);
    if (actual !== expected) {
      outdated = true;
    }
  }
}

if (mode === "check" && outdated) {
  process.stderr.write(
    "Migration docs are out of date. Run `pnpm codemod:docs:update` to regenerate them.\n",
  );
  process.exit(1);
}
