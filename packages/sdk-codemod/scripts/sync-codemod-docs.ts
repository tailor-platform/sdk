#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMigrationDoc } from "../src/migration-doc";
import { allCodemods } from "../src/registry";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// packages/sdk-codemod/scripts -> packages/sdk/docs/migration/v2.md
const docPath = resolve(scriptDir, "../../sdk/docs/migration/v2.md");

function parseMode(args: string[]): "write" | "check" {
  const modes = args.filter((arg) => arg === "--check" || arg === "--write");
  if (modes.length !== 1 || modes.length !== args.length) {
    process.stderr.write("Usage: tsx scripts/sync-codemod-docs.ts --check|--write\n");
    process.exit(2);
  }
  return modes[0] === "--write" ? "write" : "check";
}

const mode = parseMode(process.argv.slice(2));
const expected = renderMigrationDoc(allCodemods);

if (mode === "write") {
  await writeFile(docPath, expected, "utf-8");
  process.stderr.write(`Wrote ${docPath}\n`);
} else {
  const actual = await readFile(docPath, "utf-8").catch(() => null);
  if (actual !== expected) {
    process.stderr.write(
      "Migration doc is out of date. Run `pnpm codemod:docs:update` to regenerate it.\n",
    );
    process.exit(1);
  }
}
