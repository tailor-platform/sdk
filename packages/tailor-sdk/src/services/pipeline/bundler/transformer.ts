/* eslint-disable no-case-declarations */

import fs from "node:fs";
import path from "node:path";
import ml from "multiline-ts";
import { parseSync } from "oxc-parser";
import { measure } from "@/performance";
import { Resolver } from "../resolver";

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

export class CodeTransformer {
  constructor() {}

  @measure
  transform(
    filePath: string,
    resolver: InstanceType<typeof Resolver>,
    tempDir: string,
  ): string[] {
    const trimmedContent = this.trimSDKCode(filePath);
    const transformedPath = path.join(
      path.dirname(filePath),
      path.basename(filePath, ".js") + ".transformed.js",
    );
    fs.writeFileSync(
      transformedPath,
      ml/* js */ `
      ${trimmedContent}

      ${resolver.steps
        .flatMap(([type, name, fn]) => {
          switch (type) {
            case "fn":
            case "sql":
              return [
                /* js */ `export const ${stepVariableName(
                  name,
                )} = ${fn.toString()};`,
              ];
            case "gql":
              return [];
            default:
              throw new Error(`Unsupported step type: ${type}`);
          }
        })
        .join("\n")}

      `,
    );

    const stepDir = path.join(tempDir, "steps");
    fs.mkdirSync(stepDir, { recursive: true });

    return resolver.steps
      .filter(([type]) => type !== "gql")
      .flatMap(([type, name, _, options]) => {
        const stepFilePath = path.join(stepDir, `${resolver.name}__${name}.js`);
        const stepFunctionVariable = stepVariableName(name);
        const relativePath = path.relative(stepDir, transformedPath);
        let stepContent;
        switch (type) {
          case "fn":
            stepContent = ml/* js */ `
                import { ${stepFunctionVariable} } from "${relativePath}";
                globalThis.main = ${stepFunctionVariable};
              `;
            break;
          case "sql":
            const dbNamespace =
              options?.dbNamespace || resolver.options?.defaults?.dbNamespace;
            if (!dbNamespace) {
              throw new Error(
                `Database namespace is not defined at ${resolver.name} > ${name}`,
              );
            }
            stepContent = ml/* js */ `
                import { ${stepFunctionVariable} } from "${relativePath}";

                ${SQL_WRAPPER_DEFINITION}
                globalThis.main = ${wrapSqlFn(
                  dbNamespace,
                  stepFunctionVariable,
                )};
              `;
            break;
          default:
            return [];
        }

        fs.writeFileSync(stepFilePath, stepContent);
        return [stepFilePath];
      });
  }

  @measure
  private trimSDKCode(filePath: string): string {
    const sourceText = fs.readFileSync(filePath, "utf-8");

    try {
      const parseResult = parseSync(sourceText, {
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

      this.visitNode(program, (node: NodeWithRange) => {
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
      this.visitNode(program, (node: NodeWithRange) => {
        if (node.type === "ExportDefaultDeclaration") {
          removedRanges.add(`${node.start}-${node.end}`);
        }
      });

      // 3. 削除された識別子を使用している文を特定
      let hasChanges = true;
      while (hasChanges) {
        hasChanges = false;

        this.visitNode(program, (node: NodeWithRange) => {
          // すでに削除対象の範囲内にある場合はスキップ
          if (this.isNodeInRemovedRange(node, removedRanges)) {
            return;
          }

          // トップレベルの文を対象とする
          if (this.isTopLevelStatement(node, program)) {
            const usedIdentifiers = this.extractIdentifiers(node);
            const usesRemovedIdentifier = usedIdentifiers.some((id) =>
              removedIdentifiers.has(id),
            );

            if (usesRemovedIdentifier) {
              removedRanges.add(`${node.start}-${node.end}`);

              // この文で定義される識別子も削除対象に追加
              const definedIdentifiers =
                this.getDefinedIdentifiersFromNode(node);
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
      return this.removeRangesFromSource(sourceText, removedRanges);
    } catch (error) {
      console.error(`Failed to parse ${filePath}:`, error);
      // パースエラーの場合は元のコードをそのまま返す
      return sourceText;
    }
  }

  @measure
  private visitNode(node: any, callback: (node: NodeWithRange) => void): void {
    if (!node || typeof node !== "object") return;

    callback(node);

    for (const key in node) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          this.visitNode(item, callback);
        }
      } else if (value && typeof value === "object") {
        this.visitNode(value, callback);
      }
    }
  }

  @measure
  private isNodeInRemovedRange(
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

  @measure
  private isTopLevelStatement(node: NodeWithRange, program: any): boolean {
    return program.body && program.body.includes(node);
  }

  @measure
  private extractIdentifiers(node: NodeWithRange): string[] {
    const identifiers: string[] = [];

    this.visitNode(node, (n: NodeWithRange) => {
      if (n.type === "Identifier" && n.name) {
        identifiers.push(n.name);
      }
    });

    return identifiers;
  }

  @measure
  private getDefinedIdentifiersFromNode(node: NodeWithRange): string[] {
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

  @measure
  private removeRangesFromSource(
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
}

function stepVariableName(stepName: string) {
  return `$tailor_resolver_step__${stepName}`;
}

const SQL_WRAPPER_NAME = "$tailor_sql_step_wrapper";
function wrapSqlFn(dbNamespace: string, target: string) {
  return `await ${SQL_WRAPPER_NAME}("${dbNamespace}", ${target})`;
}
const SQL_WRAPPER_DEFINITION = ml/* js */ `
  const $connect_tailordb = async (namespace) => {
    const baseClient = new tailordb.Client({ namespace });
    await baseClient.connect();
    const client = {
      async exec(query) {
        const result = await baseClient.queryObject(query);
        return result.rows;
      },
      async execOne(query) {
        const result = await baseClient.queryObject(query);
        console.log(result);
        return result.rows[0];
      },
    };
    return {
      ...client,
      async transaction(callback) {
        try {
          await client.exec("BEGIN");
          const result = await callback(client);
          await client.exec("COMMIT");
          return result;
        } catch (e) {
          console.error("Transaction failed:", e);
          try {
            await client.exec("ROLLBACK");
          } catch (e) {
            console.error("Failed to rollback transaction:", e);
          }
        }
      }
    };
  };

  const ${SQL_WRAPPER_NAME} = async (namespace, fn) => {
    const client = await $connect_tailordb(namespace);
    return async (args) => await fn({ ...args, client });
  };
`;
