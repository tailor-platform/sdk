import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import config from "../../src/tailor.config";
import { apply, generate } from "@tailor-platform/tailor-sdk";

const __filename = url.fileURLToPath(import.meta.url);

const expectedDir = "tests/fixtures/expected";
const actualDir = "tests/fixtures/actual";

function getConfig(dist: "expected" | "actual") {
  config.generators = config.generators?.map((gen) => {
    if (Array.isArray(gen) && gen[0] === "@tailor/kysely-type") {
      return [
        gen[0],
        {
          distPath: () =>
            path.join(dist === "expected" ? expectedDir : actualDir, "db.ts"),
        },
      ];
    }
    if (Array.isArray(gen) && gen[0] === "@tailor/db-type") {
      return [
        gen[0],
        {
          distPath: () =>
            path.join(
              dist === "expected" ? expectedDir : actualDir,
              "types.ts",
            ),
        },
      ];
    }
    return gen;
  });
  return config;
}

/**
 * 期待値ファイルを生成するスクリプト
 * 現在の実装で正常な出力を生成し、期待値として保存する
 */
export async function generateExpectedFiles(): Promise<void> {
  try {
    console.log(`Expected directory: ${expectedDir}`);

    if (fs.existsSync(expectedDir)) {
      await fs.rmdirSync(expectedDir, { recursive: true });
      console.log("Removed existing expected directory");
    }

    process.env.TAILOR_SDK_OUTPUT_DIR = expectedDir;
    const config = getConfig("expected");
    await generate(config);
    await apply(config, { dryRun: true });

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

export async function generateActualFiles(): Promise<void> {
  if (fs.existsSync(actualDir)) {
    await fs.rmdirSync(actualDir, { recursive: true });
    console.log("Removed existing actual directory");
  }

  process.env.TAILOR_SDK_OUTPUT_DIR = actualDir;
  const config = getConfig("actual");
  await generate(config);
  await apply(config, { dryRun: true });

  const manifestPath = path.join(actualDir, "manifest.cue");

  const manifest = fs.readFileSync(manifestPath, "utf-8");

  fs.writeFileSync(
    manifestPath,
    manifest.replaceAll(actualDir, "tests/fixtures/expected"),
  );
}

if (process.argv[1] === __filename) {
  try {
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
