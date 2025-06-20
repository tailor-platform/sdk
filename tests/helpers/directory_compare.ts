import { compare, Options, Result } from "dir-compare";
import fs from "node:fs";
import path from "node:path";

/**
 * 2つのディレクトリを比較する
 * @param actualDir 実際の出力ディレクトリ
 * @param expectedDir 期待値ディレクトリ
 * @param options 比較オプション
 * @returns 比較結果
 */
export async function compareDirectories(
  actualDir: string,
  expectedDir: string,
  options: Partial<Options> = {},
): Promise<Result> {
  const defaultOptions: Options = {
    compareDate: false,
    excludeFilter: ".DS_Store",
    ...options,
  };

  return await compare(actualDir, expectedDir, defaultOptions);
}

/**
 * 比較結果の詳細レポートを生成する
 * @param comparison 比較結果
 * @param actualDir 実際のディレクトリパス
 * @param expectedDir 期待値ディレクトリパス
 * @returns 詳細レポート文字列
 */
export function generateDetailedDiffReport(
  comparison: Result,
  actualDir: string,
  expectedDir: string,
): string {
  const lines: string[] = [];

  lines.push(`=== Directory Comparison Report ===`);
  lines.push(`Actual:   ${actualDir}`);
  lines.push(`Expected: ${expectedDir}`);
  lines.push(`Overall Match: ${comparison.same ? "YES" : "NO"}`);
  lines.push("");

  lines.push(`Statistics:`);
  lines.push(`  Total files: ${comparison.totalFiles}`);
  lines.push(`  Equal files: ${comparison.equalFiles}`);
  lines.push(`  Different files: ${comparison.differentFiles}`);
  lines.push(`  Left only: ${comparison.leftOnlyFiles}`);
  lines.push(`  Right only: ${comparison.rightOnlyFiles}`);
  lines.push("");

  if (comparison.differences > 0) {
    lines.push(`Differences (${comparison.differences}):`);
    comparison.diffSet?.forEach((diff, index) => {
      lines.push(`  ${index + 1}. ${diff.relativePath}`);
      lines.push(`     State: ${diff.state}`);
      lines.push(
        `     Type: ${diff.type1 || "missing"} vs ${diff.type2 || "missing"}`,
      );
      if (diff.reason) {
        lines.push(`     Reason: ${diff.reason}`);
      }
      lines.push("");
    });
  }

  return lines.join("\n");
}

/**
 * 特定のファイルの内容を比較する
 * @param actualFile 実際のファイルパス
 * @param expectedFile 期待値ファイルパス
 * @returns ファイルが同じかどうか
 */
export function compareFiles(
  actualFile: string,
  expectedFile: string,
): boolean {
  try {
    if (!fs.existsSync(actualFile) || !fs.existsSync(expectedFile)) {
      return false;
    }

    const actualContent = fs.readFileSync(actualFile, "utf-8");
    const expectedContent = fs.readFileSync(expectedFile, "utf-8");

    return actualContent === expectedContent;
  } catch {
    return false;
  }
}

/**
 * JSONファイルの内容を比較する（フォーマットの違いを無視）
 * @param actualFile 実際のJSONファイルパス
 * @param expectedFile 期待値JSONファイルパス
 * @returns JSONの内容が同じかどうか
 */
export function compareJsonFiles(
  actualFile: string,
  expectedFile: string,
): boolean {
  try {
    if (!fs.existsSync(actualFile) || !fs.existsSync(expectedFile)) {
      return false;
    }

    const actualContent = JSON.parse(fs.readFileSync(actualFile, "utf-8"));
    const expectedContent = JSON.parse(fs.readFileSync(expectedFile, "utf-8"));

    return (
      JSON.stringify(actualContent, null, 2) ===
      JSON.stringify(expectedContent, null, 2)
    );
  } catch {
    return false;
  }
}

/**
 * ディレクトリ内の特定パターンのファイルを取得する
 * @param dirPath ディレクトリパス
 * @param pattern ファイルパターン（例: '*.json', '*.js'）
 * @returns マッチするファイルのパス配列
 */
export function getFilesWithPattern(
  dirPath: string,
  pattern: string,
): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files: string[] = [];
  const regex = new RegExp(pattern.replace(/\*/g, ".*"));

  function walkDir(currentPath: string) {
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        walkDir(fullPath);
      } else if (regex.test(item)) {
        files.push(fullPath);
      }
    }
  }

  walkDir(dirPath);
  return files;
}
