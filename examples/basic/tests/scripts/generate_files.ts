import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { generate, apply } from "@tailor-platform/tailor-sdk";
import { randomUUID } from "node:crypto";

const __filename = url.fileURLToPath(import.meta.url);

const expectedDir = "tests/fixtures/expected";
const actualDir = "tests/fixtures/actual";

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
 * 期待値ファイルを生成するスクリプト
 * 現在の実装で正常な出力を生成し、期待値として保存する
 */
export async function generateExpectedFiles(): Promise<void> {
  try {
    console.log(`Expected directory: ${expectedDir}`);

    if (fs.existsSync(expectedDir)) {
      fs.rmSync(expectedDir, { recursive: true });
      console.log("Removed existing expected directory");
    }

    process.env.TAILOR_SDK_OUTPUT_DIR = expectedDir;
    await generate("./tests/tailor.config.expected.ts");
    replaceAbsolutePaths(expectedDir);

    console.log("\nGenerated files:");
    await listGeneratedFiles(expectedDir);
  } catch (error) {
    console.error("Error generating expected files:", error);
    throw error;
  }
}

/**
 * 生成されたファイルの一覧を表示する
 * @param dirPath ディレクトリパス
 * @param depth 現在の深度
 * @param maxDepth 最大深度
 */
async function listGeneratedFiles(
  dirPath: string,
  depth = 0,
  maxDepth = 3,
): Promise<void> {
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

export async function generateActualFiles(): Promise<void> {
  if (fs.existsSync(actualDir)) {
    fs.rmSync(actualDir, { recursive: true });
    console.log("Removed existing actual directory");
  }

  process.env.TAILOR_SDK_OUTPUT_DIR = actualDir;
  await generate("./tests/tailor.config.actual.ts");
  await apply("./tests/tailor.config.actual.ts", { buildOnly: true });
  replaceAbsolutePaths(actualDir);
}

if (process.argv[1] === __filename) {
  try {
    process.env.WORKSPACE_ID ??= randomUUID();
    if (process.argv[2] === "actual") {
      console.log("Generating actual files...");
      await generateActualFiles();
    } else {
      console.log("Generating expected files...");
      await generateExpectedFiles();
    }
  } catch (error) {
    console.error("\n❌ Failed to generate expected files:", error);
    process.exit(1);
  }
}
