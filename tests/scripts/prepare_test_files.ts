import path from "node:path";
import { createTempDirectory } from "../helpers/file_utils";
import config from "../../src/tailor.config";
import { apply, generate } from "@tailor-platform/tailor-sdk";

async function prepareTestFiles() {
  console.log("テストファイルの準備を開始します...");

  const tempDistDir = await createTempDirectory("test-");
  process.env.TAILOR_SDK_OUTPUT_DIR = tempDistDir;

  console.log(`生成ディレクトリ: ${tempDistDir}`);

  // generate と apply を実行
  await generate(config);
  await apply(config, { dryRun: true });

  console.log("テストファイルの準備が完了しました");
  console.log(`TAILOR_SDK_OUTPUT_DIR=${tempDistDir}`);

  // 環境変数をファイルに保存
  const fs = await import("node:fs/promises");
  await fs.writeFile(
    path.join(process.cwd(), "tests/.test-env"),
    `TAILOR_SDK_OUTPUT_DIR=${tempDistDir}\n`,
  );
}

prepareTestFiles().catch(console.error);
