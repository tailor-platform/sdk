import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
// eslint-disable-next-line no-restricted-imports -- test fixture script, node:path is fine here
import * as path from "node:path";
import { deploy } from "#src/cli/commands/deploy/deploy";
import { generate } from "#src/cli/commands/generate/service";
import type { BundledScripts } from "#src/cli/commands/deploy/function-registry";

const fixtureDir = path.dirname(new URL(import.meta.url).pathname);
const outputDir = path.join(fixtureDir, "dist");

/**
 * Generates and builds test fixture output (plugins + bundles).
 * @returns The output directory path and in-memory bundled scripts.
 */
export async function prepareFixtures(): Promise<{
  outputDir: string;
  bundledScripts: BundledScripts;
}> {
  process.env.TAILOR_PLATFORM_WORKSPACE_ID ??= randomUUID();

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }

  const configPath = path.join(fixtureDir, "tailor.config.ts");

  process.env.TAILOR_SDK_OUTPUT_DIR = outputDir;

  // Generate plugin output (db.ts, enums.ts)
  await generate({ configPath });

  // Build resolver/executor/workflow bundles (in-memory)
  const result = await deploy({ configPath, buildOnly: true });
  const bundledScripts = result!.bundledScripts;

  return { outputDir, bundledScripts };
}
