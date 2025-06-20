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

/**
 * ディレクトリ構造を文字列として表現する
 * @param dirPath ディレクトリパス
 * @param maxDepth 最大深度
 * @returns ディレクトリ構造の文字列表現
 */
export function getDirectoryStructure(
  dirPath: string,
  maxDepth: number = 3,
): string {
  const lines: string[] = [];

  function walkDir(currentPath: string, depth: number, prefix: string = "") {
    if (depth > maxDepth) return;

    const items = fs.readdirSync(currentPath).sort();

    items.forEach((item, index) => {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);
      const isLast = index === items.length - 1;
      const connector = isLast ? "└── " : "├── ";

      lines.push(`${prefix}${connector}${item}`);

      if (stat.isDirectory() && depth < maxDepth) {
        const newPrefix = prefix + (isLast ? "    " : "│   ");
        walkDir(fullPath, depth + 1, newPrefix);
      }
    });
  }

  lines.push(path.basename(dirPath) + "/");
  walkDir(dirPath, 0);

  return lines.join("\n");
}
