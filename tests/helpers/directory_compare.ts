import { compare, Options, Result } from "dir-compare";
import fs from "node:fs";
import path from "node:path";

// ANSIカラーコード
const COLORS = {
  GREEN: "\x1b[32m", // 緑色（期待値にのみ存在）
  RED: "\x1b[31m", // 赤色（実際の結果にのみ存在）
  RESET: "\x1b[0m", // リセット
} as const;

// ツリー構造表示用の文字
const TREE_CHARS = {
  BRANCH: "├── ",
  LAST_BRANCH: "└── ",
  VERTICAL: "│   ",
  SPACE: "    ",
} as const;

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
 * 視覚的な差分レポートを生成する
 * @param comparison 比較結果
 * @param actualDir 実際のディレクトリパス
 * @param expectedDir 期待値ディレクトリパス
 * @returns 視覚的差分レポート文字列
 */
export function generateVisualDiffReport(
  comparison: Result,
  actualDir: string,
  expectedDir: string,
): string {
  const lines: string[] = [];

  lines.push("=== Visual Directory Diff Report ===");
  lines.push(`${COLORS.RED}-${COLORS.RESET} Expected only`);
  lines.push(`${COLORS.GREEN}+${COLORS.RESET} Actual only`);
  lines.push("");

  // ディレクトリ構造を構築
  const treeStructure = buildTreeStructure(actualDir, expectedDir);

  // ツリー構造を文字列として出力
  const treeOutput = renderTree(treeStructure);
  lines.push(treeOutput);

  return lines.join("\n");
}

/**
 * ディレクトリ比較結果からツリー構造を構築する
 */
function buildTreeStructure(actualDir: string, expectedDir: string): TreeNode {
  const root: TreeNode = {
    name: path.basename(actualDir) || "root",
    type: "directory",
    status: "both",
    children: new Map(),
  };

  if (fs.existsSync(actualDir)) {
    scanDirectory(actualDir, actualDir, root, "actual");
  }
  if (fs.existsSync(expectedDir)) {
    scanDirectory(expectedDir, expectedDir, root, "expected");
  }

  return root;
}

/**
 * ディレクトリをスキャンしてツリー構造に追加する
 */
function scanDirectory(
  dirPath: string,
  basePath: string,
  parentNode: TreeNode,
  source: "actual" | "expected",
): void {
  try {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      if (item === ".DS_Store") continue; // macOSの隠しファイルをスキップ

      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      const isDirectory = stat.isDirectory();

      let child = parentNode.children.get(item);
      if (!child) {
        child = {
          name: item,
          type: isDirectory ? "directory" : "file",
          status: source === "actual" ? "actual-only" : "expected-only",
          children: new Map(),
        };
        parentNode.children.set(item, child);
      } else {
        // 両方に存在する場合
        child.status = "both";
      }

      if (isDirectory) {
        scanDirectory(fullPath, basePath, child, source);
      }
    }
  } catch {
    // ディレクトリの読み取りに失敗した場合は無視
  }
}

/**
 * ツリー構造をレンダリングする
 */
function renderTree(node: TreeNode, prefix: string = ""): string {
  const lines: string[] = [];

  // ルートノードの場合は特別な処理
  if (prefix === "") {
    lines.push(formatNodeName(node));
  }

  const children = Array.from(node.children.values());
  children.forEach((child, index) => {
    const isLastChild = index === children.length - 1;
    const currentPrefix = prefix === "" ? "" : prefix + TREE_CHARS.SPACE;
    const connector = isLastChild ? TREE_CHARS.LAST_BRANCH : TREE_CHARS.BRANCH;

    lines.push(currentPrefix + connector + formatNodeName(child));
    if (child.children.size > 0) {
      const childPrefix =
        currentPrefix + (isLastChild ? TREE_CHARS.SPACE : TREE_CHARS.VERTICAL);
      const childOutput = renderTree(child, childPrefix);
      const childLines = childOutput
        .split("\n")
        .filter((line) => line.trim() !== "");
      lines.push(...childLines);
    }
  });

  return lines.join("\n");
}

/**
 * ノード名をフォーマットする（色付きで状態を表示）
 */
function formatNodeName(node: TreeNode): string {
  const typeIndicator = node.type === "directory" ? "/" : "";

  switch (node.status) {
    case "expected-only":
      return `${COLORS.RED}- ${node.name}${typeIndicator}${COLORS.RESET}`;
    case "actual-only":
      return `${COLORS.GREEN}+ ${node.name}${typeIndicator}${COLORS.RESET}`;
    case "both":
      return `${node.name}${typeIndicator}`;
    default:
      return `${node.name}${typeIndicator}`;
  }
}

/**
 * ツリーノードの型定義
 */
interface TreeNode {
  name: string;
  type: "file" | "directory";
  status: "both" | "actual-only" | "expected-only";
  children: Map<string, TreeNode>;
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

  // 視覚的差分レポートを追加
  lines.push("");
  lines.push(generateVisualDiffReport(comparison, actualDir, expectedDir));

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
