import { randomUUID } from "node:crypto";
import fs from "node:fs";
// eslint-disable-next-line no-restricted-imports -- test fixture script, node:path is fine here
import path from "node:path";
import { apply } from "@/cli/commands/apply/apply";
import { generate } from "@/cli/commands/generate/service";

const fixtureDir = path.dirname(new URL(import.meta.url).pathname);
const outputDir = path.join(fixtureDir, "dist");

function replaceAbsolutePaths(dirPath: string) {
  const items = fs.readdirSync(dirPath);
  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      replaceAbsolutePaths(fullPath);
    } else if (item.endsWith(".js") || item.endsWith(".js.map")) {
      const content = fs.readFileSync(fullPath, "utf-8");
      fs.writeFileSync(
        fullPath,
        content.replace(/"\/[^"]*\/node_modules\/([^"]*)"/g, (_, pkgPath) => {
          return `"/dummy/path/node_modules/${pkgPath}"`;
        }),
        "utf-8",
      );
    }
  }
}

/**
 * Generates and builds test fixture output (plugins + bundles).
 * @returns The output directory path containing generated files.
 */
export async function prepareFixtures(): Promise<string> {
  process.env.TAILOR_PLATFORM_WORKSPACE_ID ??= randomUUID();

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }

  const configPath = path.join(fixtureDir, "tailor.config.ts");

  process.env.TAILOR_SDK_OUTPUT_DIR = outputDir;

  // Generate plugin output (db.ts, enums.ts)
  await generate({ configPath });

  // Build resolver/executor/workflow bundles
  await apply({ configPath, buildOnly: true });

  replaceAbsolutePaths(outputDir);

  return outputDir;
}
