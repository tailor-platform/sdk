#!/usr/bin/env tsx

import url from "node:url";
import path from "node:path";
import { Workspace } from "./workspace";
import { Tailor } from "./tailor";
import type { WorkspaceConfig } from "./config";

const __filename = url.fileURLToPath(import.meta.url);

async function loadConfig(configPath: string): Promise<WorkspaceConfig> {
  try {
    const resolvedPath = path.resolve(process.cwd(), configPath);
    const configModule = await import(resolvedPath);

    if (!configModule || !configModule.default) {
      throw new Error("Invalid Tailor config module: default export not found");
    }

    return configModule.default as WorkspaceConfig;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Cannot find module")
    ) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    throw error;
  }
}

async function main() {
  try {
    // コマンドライン引数からconfig pathを取得（デフォルトは tailor.config.ts）
    const configPath = process.argv[2] || "tailor.config.ts";

    // 設定ファイルをロード
    const config = await loadConfig(configPath);

    // SDKを初期化
    const sdkTempDir = path.join(process.cwd(), ".tailor-sdk");
    Tailor.init(sdkTempDir);

    // Workspaceを作成して設定を適用
    const workspace = new Workspace(config.name);
    const app = workspace.newApplication(config.app.name);
    app.defineTailorDB(config.app.db);
    app.defineResolver(config.app.resolver);
    app.defineAuth(config.app.auth);

    // ctlApplyを実行
    await workspace.ctlApply();
    console.log("Configuration applied successfully.");
  } catch (error) {
    console.error("Failed to apply configuration:", error);
    // スタックトレースも出力
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

// スクリプトとして直接実行された場合のみmainを実行
if (process.argv[1] === __filename) {
  main().catch(console.error);
}
