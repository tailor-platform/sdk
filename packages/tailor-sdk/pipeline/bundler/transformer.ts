import fs from "node:fs";
import path from "node:path";
import outdent from "multiline-ts";
import {
  Node,
  Project,
  Statement,
  Symbol,
  SyntaxKind,
  VariableDeclaration,
} from "ts-morph";
import { Step } from "./types";

export class CodeTransformer {
  private project: Project;

  constructor() {
    this.project = new Project({
      tsConfigFilePath: "./tsconfig.json",
      compilerOptions: {
        allowJs: true,
        checkJs: false,
      },
    });
  }

  transform(filePath: string, steps: Step[], tempDir: string): string[] {
    const trimmedContent = this.trimSDKCode(filePath);
    fs.writeFileSync(
      filePath,
      outdent`
      ${trimmedContent}
      ${
        steps.map(({ name, fn }) =>
          /* js */ `export const $tailor_resolver_step__${name} = ${fn.toString()};`
        ).join("\n")
      }
      `,
    );

    const resolverId = path.basename(filePath, ".js");
    const stepDir = path.join(tempDir, "steps");
    fs.mkdirSync(stepDir, { recursive: true });

    return steps.map(({ name }) => {
      const stepFilePath = path.join(stepDir, `${resolverId}__${name}.js`);
      const stepFunctionVariable = `$tailor_resolver_step__${name}`;
      const stepContent = outdent /* js */`
      import { ${stepFunctionVariable} } from "${
        path.relative(stepDir, filePath)
      }";
      globalThis.main = ${stepFunctionVariable};
      `;
      fs.writeFileSync(stepFilePath, stepContent);
      return stepFilePath;
    });
  }

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
      // Named imports の処理
      const namedImports = importDecl.getNamedImports();
      namedImports.forEach((namedImport: any) => {
        const nameNode = namedImport.getNameNode();
        const aliasNode = namedImport.getAliasNode();

        // 実際に使用される識別子（エイリアスがあればエイリアス、なければ元の名前）
        const identifierToTrack = aliasNode || nameNode;

        const symbol = identifierToTrack.getSymbol();
        if (symbol) {
          const identifierName = identifierToTrack.getText();
          removedIdentifiers.add(symbol);
        }
      });

      // Default import の処理
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        const symbol = defaultImport.getSymbol();
        if (symbol) {
          const identifierName = defaultImport.getText();
          removedIdentifiers.add(symbol);
        }
      }

      // Namespace import の処理
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        const symbol = namespaceImport.getSymbol();
        symbol && removedIdentifiers.add(symbol);
      }
    });

    // 3. ファイル内の全ての識別子をチェックして、インポートされたSymbolを参照しているものを特定
    const allIdentifiers = sourceFile.getDescendantsOfKind(
      SyntaxKind.Identifier,
    );
    allIdentifiers[0]?.getSymbol();
    allIdentifiers.forEach((identifier) => {
      const symbol = identifier.getSymbol();
      if (symbol && removedIdentifiers.has(symbol)) {
        // インポート宣言自体は除外
        if (
          !identifier.getAncestors().some((ancestor) =>
            tailorSdkImportDeclarations.includes(ancestor)
          )
        ) {
          importedIdentifierReferences.add(identifier);
        }
      }
    });

    // 4. インポートされた識別子を使用している文を特定
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

    // 5. 依存関係を再帰的に追跡
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

        // 削除された識別子を使用しているかチェック（従来のロジック）
        const identifiersInStatement = statement.getDescendantsOfKind(
          SyntaxKind.Identifier,
        );
        const usedRemovedIdentifiers = identifiersInStatement
          .filter((id) => id.getSymbol() != null)
          .filter((identifier) =>
            removedIdentifiers.has(identifier.getSymbol() as Symbol)
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

  private getDefinedIdentifiers(statement: Statement): Symbol[] {
    const identifiers: Symbol[] = [];

    if (statement.getKind() === SyntaxKind.VariableStatement) {
      const variableStatement = statement.asKindOrThrow(
        SyntaxKind.VariableStatement,
      );
      const declarations = variableStatement.getDeclarationList()
        .getDeclarations();
      declarations.map((decl: VariableDeclaration) =>
        decl.getNameNode().getSymbol() as Symbol
      ).forEach((s) => s && identifiers.push(s));
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
