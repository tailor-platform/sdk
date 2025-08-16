import fs from "node:fs";
import { parseSync } from "oxc-parser";

interface ImportInfo {
  source: string;
  specifiers: Array<{
    imported: string;
    local: string;
  }>;
  defaultImport?: string;
  namespaceImport?: string;
}

interface NodeWithRange {
  type: string;
  start: number;
  end: number;
  [key: string]: any;
}

export function trimSDKCode(filePath: string): string {
  const sourceText = fs.readFileSync(filePath, "utf-8");

  try {
    const parseResult = parseSync(filePath, sourceText, {
      sourceType: "module",
    });

    if (parseResult.errors && parseResult.errors.length > 0) {
      console.warn(`Parse errors in ${filePath}:`, parseResult.errors);
    }

    const program = parseResult.program;
    const removedRanges = new Set<string>();
    const removedIdentifiers = new Set<string>();

    // 1. @tailor-platform/tailor-sdk からのインポートを処理
    const tailorSdkImports: ImportInfo[] = [];

    visitNode(program, (node: NodeWithRange) => {
      if (
        node.type === "ImportDeclaration" &&
        node.source?.value === "@tailor-platform/tailor-sdk"
      ) {
        const importInfo: ImportInfo = {
          source: node.source.value,
          specifiers: [],
        };

        if (node.specifiers) {
          for (const spec of node.specifiers) {
            if (spec.type === "ImportSpecifier") {
              const imported = spec.imported?.name || spec.local?.name;
              const local = spec.local?.name;
              if (imported && local) {
                importInfo.specifiers.push({ imported, local });
                removedIdentifiers.add(local);
              }
            } else if (spec.type === "ImportDefaultSpecifier") {
              importInfo.defaultImport = spec.local?.name;
              if (spec.local?.name) {
                removedIdentifiers.add(spec.local.name);
              }
            } else if (spec.type === "ImportNamespaceSpecifier") {
              importInfo.namespaceImport = spec.local?.name;
              if (spec.local?.name) {
                removedIdentifiers.add(spec.local.name);
              }
            }
          }
        }

        tailorSdkImports.push(importInfo);
        removedRanges.add(`${node.start}-${node.end}`);
      }
    });

    // 2. export default文を削除
    visitNode(program, (node: NodeWithRange) => {
      if (node.type === "ExportDefaultDeclaration") {
        removedRanges.add(`${node.start}-${node.end}`);
      }
    });

    // 3. 削除された識別子を使用している文を特定
    let hasChanges = true;
    while (hasChanges) {
      hasChanges = false;

      visitNode(program, (node: NodeWithRange) => {
        // すでに削除対象の範囲内にある場合はスキップ
        if (isNodeInRemovedRange(node, removedRanges)) {
          return;
        }

        // トップレベルの文を対象とする
        if (isTopLevelStatement(node, program)) {
          const usedIdentifiers = extractIdentifiers(node);
          const usesRemovedIdentifier = usedIdentifiers.some((id) =>
            removedIdentifiers.has(id),
          );

          if (usesRemovedIdentifier) {
            removedRanges.add(`${node.start}-${node.end}`);

            // この文で定義される識別子も削除対象に追加
            const definedIdentifiers = getDefinedIdentifiersFromNode(node);
            for (const id of definedIdentifiers) {
              if (!removedIdentifiers.has(id)) {
                removedIdentifiers.add(id);
                hasChanges = true;
              }
            }
          }
        }
      });
    }

    // 4. コードから削除対象の範囲を除去
    return removeRangesFromSource(sourceText, removedRanges);
  } catch (error) {
    console.error(`Failed to parse ${filePath}:`, error);
    // パースエラーの場合は元のコードをそのまま返す
    return sourceText;
  }
}

function visitNode(node: any, callback: (node: NodeWithRange) => void): void {
  if (!node || typeof node !== "object") return;

  callback(node);

  for (const key in node) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        visitNode(item, callback);
      }
    } else if (value && typeof value === "object") {
      visitNode(value, callback);
    }
  }
}

function isNodeInRemovedRange(
  node: NodeWithRange,
  removedRanges: Set<string>,
): boolean {
  for (const range of removedRanges) {
    const [start, end] = range.split("-").map(Number);
    if (node.start >= start && node.end <= end) {
      return true;
    }
  }
  return false;
}

function isTopLevelStatement(node: NodeWithRange, program: any): boolean {
  return program.body && program.body.includes(node);
}

function extractIdentifiers(node: NodeWithRange): string[] {
  const identifiers: string[] = [];

  visitNode(node, (n: NodeWithRange) => {
    if (n.type === "Identifier" && n.name) {
      identifiers.push(n.name);
    }
  });

  return identifiers;
}

function getDefinedIdentifiersFromNode(node: NodeWithRange): string[] {
  const identifiers: string[] = [];

  switch (node.type) {
    case "VariableDeclaration":
      if (node.declarations) {
        for (const decl of node.declarations) {
          if (decl.id?.type === "Identifier" && decl.id.name) {
            identifiers.push(decl.id.name);
          }
        }
      }
      break;
    case "FunctionDeclaration":
      if (node.id?.name) {
        identifiers.push(node.id.name);
      }
      break;
    case "ClassDeclaration":
      if (node.id?.name) {
        identifiers.push(node.id.name);
      }
      break;
  }

  return identifiers;
}

function removeRangesFromSource(
  sourceText: string,
  removedRanges: Set<string>,
): string {
  if (removedRanges.size === 0) {
    return sourceText;
  }

  // 範囲を開始位置でソート
  const sortedRanges = Array.from(removedRanges)
    .map((range) => {
      const [start, end] = range.split("-").map(Number);
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);

  // 重複する範囲をマージ
  const mergedRanges = [];
  let current = sortedRanges[0];

  for (let i = 1; i < sortedRanges.length; i++) {
    const next = sortedRanges[i];
    if (current.end >= next.start) {
      current.end = Math.max(current.end, next.end);
    } else {
      mergedRanges.push(current);
      current = next;
    }
  }
  mergedRanges.push(current);

  // 後ろから削除して位置がずれないようにする
  let result = sourceText;
  for (let i = mergedRanges.length - 1; i >= 0; i--) {
    const { start, end } = mergedRanges[i];
    result = result.slice(0, start) + result.slice(end);
  }

  return result.replace(/(\n\s*){3,}/g, "\n\n").trim();
}
