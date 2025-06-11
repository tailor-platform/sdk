import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { apply } from "../../src/app";
import { getDirectoryStructure } from "../helpers/file_utils";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 期待値ファイルを生成するスクリプト
 * 現在の実装で正常な出力を生成し、期待値として保存する
 */
export async function generateExpectedFiles(): Promise<void> {
  console.log("Generating expected files...");

  const expectedDir = path.join(__dirname, "../fixtures/expected");

  try {
    console.log(`Expected directory: ${expectedDir}`);

    const currentDistDir = path.join(process.cwd(), "dist");

    if (!fs.existsSync(currentDistDir)) {
      throw new Error(
        `dist directory not found in current working directory: ${process.cwd()}`,
      );
    }

    console.log("Using current dist directory:");
    console.log(getDirectoryStructure(currentDistDir));

    if (fs.existsSync(expectedDir)) {
      await fs.rmdirSync(expectedDir, { recursive: true });
      console.log("Removed existing expected directory");
    }

    await fs.cpSync(currentDistDir, expectedDir, {
      recursive: true,
      force: true,
    });
    console.log(`Expected files copied to: ${expectedDir}`);

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
  depth: number = 0,
  maxDepth: number = 3,
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

if (process.argv[1] === __filename) {
  try {
    await apply();
    console.log(
      "\n✅ Application applied successfully. Generating expected files...",
    );
    await generateExpectedFiles();
  } catch (error) {
    console.error("\n❌ Failed to generate expected files:", error);
    process.exit(1);
  }
}
