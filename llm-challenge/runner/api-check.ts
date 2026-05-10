import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { ApiCheckConfig, ApiCheckPattern, ProblemMeta } from "../shared/helpers";
import type { StageInput } from "./verify";

type CheckResult = {
  name: string;
  passed: boolean;
  message: string;
};

type SdkImport = {
  file: string;
  symbol: string;
};

function sourceFileFor(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function collectPublicSdkExports(workDir: string, challengeRoot?: string): Set<string> {
  const candidates = [
    path.join(
      workDir,
      "node_modules",
      "@tailor-platform",
      "sdk",
      "dist",
      "configure",
      "index.d.mts",
    ),
  ];
  if (challengeRoot) {
    candidates.push(
      path.join(challengeRoot, "..", "packages", "sdk", "dist", "configure", "index.d.mts"),
    );
  }

  const dtsPath = candidates.find((candidate) => fs.existsSync(candidate));
  const exports = new Set<string>();
  if (!dtsPath) {
    return exports;
  }

  const source = sourceFileFor(dtsPath);
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          exports.add(element.name.text);
        }
      }
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const hasExport = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExport) {
      continue;
    }
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.length === 1 &&
      ts.isIdentifier(statement.declarationList.declarations[0]!.name)
    ) {
      exports.add(statement.declarationList.declarations[0]!.name.text);
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      statement.name
    ) {
      exports.add(statement.name.text);
    }
  }

  return exports;
}

function collectSdkImports(workDir: string, files: string[]): SdkImport[] {
  const imports: SdkImport[] = [];
  for (const file of files) {
    const filePath = path.join(workDir, file);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const source = sourceFileFor(filePath);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) {
        continue;
      }
      if (!ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      if (statement.moduleSpecifier.text !== "@tailor-platform/sdk") {
        continue;
      }
      const clause = statement.importClause;
      if (!clause) {
        continue;
      }
      if (clause.name) {
        imports.push({ file, symbol: "default" });
      }
      const bindings = clause.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) {
        continue;
      }
      for (const element of bindings.elements) {
        // Resolve to the exported name; element.propertyName is set when aliased
        // (`import { db as tailorDb }` → propertyName=db, name=tailorDb).
        imports.push({ file, symbol: (element.propertyName ?? element.name).text });
      }
    }
  }
  return imports;
}

function checkRequiredSdkImports(
  importedSymbols: Set<string>,
  config: ApiCheckConfig,
): CheckResult[] {
  return (config.requiredSdkImports ?? []).map((symbol) => ({
    name: `required-sdk-import:${symbol}`,
    passed: importedSymbols.has(symbol),
    message: importedSymbols.has(symbol)
      ? `Found required @tailor-platform/sdk import: ${symbol}`
      : `Missing required @tailor-platform/sdk import: ${symbol}`,
  }));
}

function checkForbiddenSdkImports(
  importedSymbols: Set<string>,
  config: ApiCheckConfig,
): CheckResult[] {
  return (config.forbiddenSdkImports ?? []).map((symbol) => ({
    name: `forbidden-sdk-import:${symbol}`,
    passed: !importedSymbols.has(symbol),
    message: importedSymbols.has(symbol)
      ? `Forbidden @tailor-platform/sdk import: ${symbol}`
      : `Did not find forbidden @tailor-platform/sdk import: ${symbol}`,
  }));
}

function checkUnknownSdkImports(
  imports: SdkImport[],
  publicExports: Set<string>,
  config: ApiCheckConfig,
): CheckResult[] {
  if (config.checkUnknownSdkImports === false || publicExports.size === 0) {
    return [];
  }
  return imports
    .filter((item) => item.symbol === "default" || !publicExports.has(item.symbol))
    .map((item) => ({
      name: `unknown-sdk-import:${item.symbol}`,
      passed: false,
      message: `Unknown @tailor-platform/sdk import: ${item.symbol} (${item.file})`,
    }));
}

function collectImportSpecifierRanges(source: ts.SourceFile): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      ranges.push([statement.moduleSpecifier.getStart(source), statement.moduleSpecifier.getEnd()]);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      ranges.push([statement.moduleSpecifier.getStart(source), statement.moduleSpecifier.getEnd()]);
    }
  }
  return ranges;
}

/**
 * Replace comments and string/template literal bodies with same-length whitespace
 * so pattern matching cannot be tricked by harmless mentions in comments
 * (`// don't use createResolver`) or string literals (`"db.type().hooks("`).
 * Import/export module specifiers are preserved so forbidden-package patterns
 * such as `@tailor-platform/kysely-types` still match the import source.
 * Length preservation keeps regex offsets compatible with `m` flag semantics.
 */
function stripCommentsAndStringBodies(source: string): string {
  const sourceFile = ts.createSourceFile("__check__.ts", source, ts.ScriptTarget.Latest, true);
  const importSpecifierRanges = collectImportSpecifierRanges(sourceFile);
  const isInImportSpecifier = (pos: number): boolean =>
    importSpecifierRanges.some(([start, end]) => pos >= start && pos < end);

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false);
  scanner.setText(source);
  const out: string[] = [];
  while (true) {
    const token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) break;
    const text = scanner.getTokenText();
    const tokenStart = scanner.getTokenStart();
    const isComment =
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia;
    const isStringLike =
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle ||
      token === ts.SyntaxKind.TemplateTail;
    if (isComment || (isStringLike && !isInImportSpecifier(tokenStart))) {
      out.push(text.replace(/[^\n]/g, " "));
    } else {
      out.push(text);
    }
  }
  return out.join("");
}

function readCandidateSource(
  workDir: string,
  files: string[] | undefined,
  implementFiles: string[],
): string {
  const targetFiles = files ?? implementFiles;
  return targetFiles
    .map((file) => {
      const filePath = path.join(workDir, file);
      if (!fs.existsSync(filePath)) return "";
      return stripCommentsAndStringBodies(fs.readFileSync(filePath, "utf-8"));
    })
    .join("\n");
}

function checkRequiredPatterns(
  workDir: string,
  patterns: ApiCheckPattern[] | undefined,
  implementFiles: string[],
): CheckResult[] {
  return (patterns ?? []).map((item) => {
    const source = readCandidateSource(workDir, item.files, implementFiles);
    const pattern = new RegExp(item.pattern, "m");
    const passed = pattern.test(source);
    return {
      name: `required-pattern:${item.name}`,
      passed,
      message: passed
        ? `Found required pattern: ${item.name}`
        : (item.message ?? `Missing required pattern: ${item.name}`),
    };
  });
}

function checkForbiddenPatterns(
  workDir: string,
  patterns: ApiCheckPattern[] | undefined,
  implementFiles: string[],
): CheckResult[] {
  return (patterns ?? []).map((item) => {
    const source = readCandidateSource(workDir, item.files, implementFiles);
    const pattern = new RegExp(item.pattern, "m");
    const passed = !pattern.test(source);
    return {
      name: `forbidden-pattern:${item.name}`,
      passed,
      message: passed
        ? `Did not find forbidden pattern: ${item.name}`
        : (item.message ?? `Forbidden pattern matched: ${item.name}`),
    };
  });
}

export function runApiCheck(
  workDir: string,
  meta: ProblemMeta,
  challengeRoot?: string,
): StageInput | undefined {
  if (!meta.apiCheck) {
    return undefined;
  }

  const imports = collectSdkImports(workDir, meta.files.implement);
  const importedSymbols = new Set(imports.map((item) => item.symbol));
  const publicExports = collectPublicSdkExports(workDir, challengeRoot);
  const checks = [
    ...checkUnknownSdkImports(imports, publicExports, meta.apiCheck),
    ...checkRequiredSdkImports(importedSymbols, meta.apiCheck),
    ...checkForbiddenSdkImports(importedSymbols, meta.apiCheck),
    ...checkRequiredPatterns(workDir, meta.apiCheck.requiredPatterns, meta.files.implement),
    ...checkForbiddenPatterns(workDir, meta.apiCheck.forbiddenPatterns, meta.files.implement),
  ];

  const testsTotal = checks.length;
  const testsPassed = checks.filter((check) => check.passed).length;
  const failed = checks.filter((check) => !check.passed);
  return {
    stage: "apiCheck",
    passed: failed.length === 0,
    output:
      failed.length === 0
        ? checks.map((check) => check.message).join("\n")
        : failed.map((check) => check.message).join("\n"),
    testsPassed,
    testsTotal,
  };
}
