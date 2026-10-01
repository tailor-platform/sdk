#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderedTemplatesFingerprint } from "../src/template-fingerprint";
import { resolvePendingTemplateVersion } from "../src/template-version";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const templatesPath = resolve(srcDir, "templates.ts");
const fingerprintPath = resolve(srcDir, "template-fingerprint.json");

const result = resolvePendingTemplateVersion(
  await readFile(templatesPath, "utf-8"),
  renderedTemplatesFingerprint(),
);
if (!result.changed || !result.fingerprint) {
  process.stderr.write("No pending template change to release.\n");
  process.exit(0);
}

await writeFile(templatesPath, result.source, "utf-8");
await writeFile(fingerprintPath, `${JSON.stringify(result.fingerprint, null, 2)}\n`, "utf-8");
process.stderr.write(`Released template version ${String(result.fingerprint.version)}.\n`);
