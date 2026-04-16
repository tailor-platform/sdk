import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { generate, apply } from "@tailor-platform/sdk/cli";

// Disable inline sourcemaps during test fixture generation so that snapshot
// comparisons remain stable across environments.
process.env.TAILOR_ENABLE_INLINE_SOURCEMAP ??= "false";

const __filename = url.fileURLToPath(import.meta.url);

const expectedDir = "tests/fixtures/expected";

function replaceAbsolutePaths(dirPath: string) {
  const items = fs.readdirSync(dirPath);

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      replaceAbsolutePaths(fullPath);
    } else if (item.endsWith(".js") || item.endsWith(".js.map")) {
      replaceAbsolutePathsInFile(fullPath);
    }
  }
}

function replaceAbsolutePathsInFile(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8");

  fs.writeFileSync(
    filePath,
    content.replace(/"\/[^"]*\/node_modules\/([^"]*)"/g, (_, pkgPath) => {
      return `"/dummy/path/node_modules/${pkgPath}"`;
    }),
    "utf-8",
  );
}

/**
 * Script to generate expected files
 * Generates correct output with the current implementation and saves as expected values
 */
export async function generateExpectedFiles(): Promise<void> {
  try {
    console.log(`Expected directory: ${expectedDir}`);

    if (fs.existsSync(expectedDir)) {
      fs.rmSync(expectedDir, { recursive: true });
      console.log("Removed existing expected directory");
    }

    process.env.TAILOR_SDK_OUTPUT_DIR = expectedDir;
    await generate({
      configPath: "./tests/tailor.config.expected.ts",
    });
    replaceAbsolutePaths(expectedDir);

    console.log("\nGenerated files:");
    await listGeneratedFiles(expectedDir);
  } catch (error) {
    console.error("Error generating expected files:", error);
    throw error;
  }
}

/**
 * Display list of generated files
 * @param dirPath Directory path
 * @param depth Current depth
 * @param maxDepth Maximum depth
 */
async function listGeneratedFiles(dirPath: string, depth = 0, maxDepth = 3): Promise<void> {
  if (depth > maxDepth) return;

  const items = fs.readdirSync(dirPath).sort();

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);
    const indent = "  ".repeat(depth);

    if (stat.isDirectory()) {
      console.log(`${indent}📁 ${item}/`);
      await listGeneratedFiles(fullPath, depth + 1, maxDepth);
    } else {
      const size = stat.size;
      console.log(`${indent}📄 ${item} (${size} bytes)`);
    }
  }
}

const generatorsCompatDir = "tests/fixtures/generators";
const pluginsCompatDir = "tests/fixtures/plugins";

export async function generateCompatFiles(): Promise<void> {
  for (const dir of [generatorsCompatDir, pluginsCompatDir]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  }
  await generate({ configPath: "./tests/tailor.config.generators-compat.ts" });
  await generate({ configPath: "./tests/tailor.config.plugins-compat.ts" });

  // Also run apply --buildOnly for plugins-compat (used by bundled_execution tests)
  process.env.TAILOR_SDK_OUTPUT_DIR = pluginsCompatDir;
  const result = await apply({
    configPath: "./tests/tailor.config.plugins-compat.ts",
    buildOnly: true,
  });

  // Write in-memory bundled scripts to disk for test consumption
  if (result?.bundledScripts) {
    const kindDirMap: Record<string, string> = {
      resolvers: path.join(pluginsCompatDir, "resolvers"),
      executors: path.join(pluginsCompatDir, "executors"),
      workflowJobs: path.join(pluginsCompatDir, "workflow-jobs"),
      authHooks: path.join(pluginsCompatDir, "auth-hooks"),
    };
    for (const [kind, dirPath] of Object.entries(kindDirMap)) {
      const scripts = result.bundledScripts[kind as keyof typeof result.bundledScripts];
      if (scripts.size === 0) continue;
      fs.mkdirSync(dirPath, { recursive: true });
      for (const [name, code] of scripts) {
        fs.writeFileSync(path.join(dirPath, `${name}.js`), code);
      }
    }
  }
  replaceAbsolutePaths(pluginsCompatDir);
}

if (process.argv[1] === __filename) {
  try {
    process.env.TAILOR_PLATFORM_WORKSPACE_ID ??= randomUUID();
    if (process.argv[2] === "expected") {
      console.log("Generating expected files...");
      await generateExpectedFiles();
    } else {
      console.log("Generating compat files...");
      await generateCompatFiles();
    }
  } catch (error) {
    console.error("\n❌ Failed to generate files:", error);
    process.exit(1);
  }
}
