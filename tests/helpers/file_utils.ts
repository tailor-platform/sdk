import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * 一時ディレクトリを作成する
 * @param prefix ディレクトリ名のプレフィックス
 * @returns 作成された一時ディレクトリのパス
 */
export async function createTempDirectory(
  prefix: string = "tailor-test-",
): Promise<string> {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
