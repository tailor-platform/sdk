import path from "node:path";
import fs from "node:fs";
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

  rewriteManifest(tempDistDir);

  console.log("テストファイルの準備が完了しました");
  console.log(`TAILOR_SDK_OUTPUT_DIR=${tempDistDir}`);

  // 環境変数をファイルに保存
  fs.writeFileSync(
    path.join(process.cwd(), "tests/.test-env"),
    `TAILOR_SDK_OUTPUT_DIR=${tempDistDir}\n`,
  );
}

function rewriteManifest(tempDistDir: string) {
  const manifestPath = path.join(tempDistDir, "manifest.cue");

  const manifest = fs.readFileSync(manifestPath, "utf-8");

  fs.writeFileSync(
    manifestPath,
    manifest.replaceAll(tempDistDir, "tests/fixtures/expected"),
  );
}

prepareTestFiles().catch(console.error);
