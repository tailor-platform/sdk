/* eslint-disable no-case-declarations */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import fs from "node:fs";
import path from "node:path";
import ml from "multiline-ts";
import {
  Node,
  Project,
  Statement,
  Symbol,
  SyntaxKind,
  VariableDeclaration,
} from "ts-morph";
import { measure } from "@/performance";
import { Resolver } from "../resolver";

export class CodeTransformer {
  private project: Project;

  constructor() {
    this.project = new Project({
      tsConfigFilePath: "./tsconfig.json",
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
      },
    });
  }

  @measure
  transform(
    filePath: string,
    resolver: InstanceType<typeof Resolver>,
    tempDir: string,
  ): string[] {
    const trimmedContent = this.trimSDKCode(filePath);
    fs.writeFileSync(
      filePath,
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
        const relativePath = path.relative(stepDir, filePath);
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
    const sourceFile = this.project.addSourceFileAtPath(filePath);

    const statementsToRemove = new Set<any>();
    const removedIdentifiers = new Set<Symbol>();

    // 1. @tailor-platform/tailor-sdk からのインポートを処理
    const tailorSdkImportDeclarations: any[] = [];
    const importDeclarations = sourceFile.getImportDeclarations();

    importDeclarations.forEach((importDecl) => {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      if (moduleSpecifier === "@tailor-platform/tailor-sdk") {
        tailorSdkImportDeclarations.push(importDecl);
        statementsToRemove.add(importDecl);
      }
    });

    // 2. インポートされた識別子のSymbolを収集
    const importedIdentifierReferences = new Set<Node>();

    tailorSdkImportDeclarations.forEach((importDecl) => {
      const namedImports = importDecl.getNamedImports();
      namedImports.forEach((namedImport: any) => {
        const nameNode = namedImport.getNameNode();
        const aliasNode = namedImport.getAliasNode();

        const identifierToTrack = aliasNode || nameNode;
        const symbol = identifierToTrack.getSymbol();
        if (symbol) {
          removedIdentifiers.add(symbol);
        }
      });

      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        const symbol = defaultImport.getSymbol();
        if (symbol) {
          removedIdentifiers.add(symbol);
        }
      }

      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        const symbol = namespaceImport.getSymbol();
        symbol && removedIdentifiers.add(symbol);
      }
    });

    const allIdentifiers = sourceFile.getDescendantsOfKind(
      SyntaxKind.Identifier,
    );
    allIdentifiers[0]?.getSymbol();
    allIdentifiers.forEach((identifier) => {
      const symbol = identifier.getSymbol();
      if (symbol && removedIdentifiers.has(symbol)) {
        // インポート宣言自体は除外
        if (
          !identifier
            .getAncestors()
            .some((ancestor) => tailorSdkImportDeclarations.includes(ancestor))
        ) {
          importedIdentifierReferences.add(identifier);
        }
      }
    });

    const referencedStatements = new Set<any>();
    importedIdentifierReferences.forEach((ref) => {
      let statement = ref;
      while (
        statement.getParent() &&
        !sourceFile.getStatements().includes(statement as any)
      ) {
        statement = statement.getParent()!;
      }

      if (sourceFile.getStatements().includes(statement as any)) {
        referencedStatements.add(statement);
      }
    });

    while (true) {
      let hasChanges = false;
      const statements = sourceFile.getStatements();

      statements.forEach((statement) => {
        if (statementsToRemove.has(statement)) {
          return;
        }

        // ExportAssignment (export default) を削除
        if (statement.getKind() === SyntaxKind.ExportAssignment) {
          const exportAssignment = statement.asKindOrThrow(
            SyntaxKind.ExportAssignment,
          );
          // export default のみを削除（export = は除外）
          if (!exportAssignment.isExportEquals()) {
            statementsToRemove.add(statement);
            hasChanges = true;
            return;
          }
        }

        if (referencedStatements.has(statement)) {
          statementsToRemove.add(statement);
          hasChanges = true;

          const identifiers = this.getDefinedIdentifiers(statement);
          identifiers.forEach((identifier) => {
            if (!removedIdentifiers.has(identifier)) {
              removedIdentifiers.add(identifier);
              hasChanges = true;
            }
          });
          return;
        }

        const identifiersInStatement = statement.getDescendantsOfKind(
          SyntaxKind.Identifier,
        );
        const usedRemovedIdentifiers = identifiersInStatement
          .filter((id) => id.getSymbol() != null)
          .filter((identifier) =>
            removedIdentifiers.has(identifier.getSymbol() as Symbol),
          );

        if (usedRemovedIdentifiers.length > 0) {
          statementsToRemove.add(statement);
          hasChanges = true;

          const identifiers = this.getDefinedIdentifiers(statement);
          identifiers.forEach((identifier) => {
            if (!removedIdentifiers.has(identifier)) {
              removedIdentifiers.add(identifier);
              hasChanges = true;
            }
          });
        }
      });

      if (!hasChanges) {
        break;
      }
    }

    statementsToRemove.forEach((statement: Statement) => {
      if (!statement.wasForgotten()) {
        statement.remove();
      }
    });

    return sourceFile.getFullText();
  }

  @measure
  private getDefinedIdentifiers(statement: Statement): Symbol[] {
    const identifiers: Symbol[] = [];

    if (statement.getKind() === SyntaxKind.VariableStatement) {
      const variableStatement = statement.asKindOrThrow(
        SyntaxKind.VariableStatement,
      );
      const declarations = variableStatement
        .getDeclarationList()
        .getDeclarations();
      declarations
        .map(
          (decl: VariableDeclaration) =>
            decl.getNameNode().getSymbol() as Symbol,
        )
        .forEach((s) => s && identifiers.push(s));
    }

    if (statement.getKind() === SyntaxKind.FunctionDeclaration) {
      const functionDecl = statement.asKindOrThrow(
        SyntaxKind.FunctionDeclaration,
      );
      const symbol = functionDecl.getNameNode()?.getSymbol();
      symbol && identifiers.push(symbol);
    }

    if (statement.getKind() === SyntaxKind.ClassDeclaration) {
      const classDecl = statement.asKindOrThrow(SyntaxKind.ClassDeclaration);
      const symbol = classDecl.getNameNode()?.getSymbol();
      symbol && identifiers.push(symbol);
    }

    return identifiers;
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
