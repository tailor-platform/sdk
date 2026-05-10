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

type SdkImportSummary = {
  imports: SdkImport[];
  hasNamespaceImport: boolean;
};

// Per-file map of local alias name → exported SDK symbol name, e.g. `tailorDb → db`.
type FileSdkAliases = Map<string, Map<string, string>>;

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

function collectSdkAliasesByFile(workDir: string, files: string[]): FileSdkAliases {
  const result: FileSdkAliases = new Map();
  for (const file of files) {
    const filePath = path.join(workDir, file);
    if (!fs.existsSync(filePath)) continue;
    const source = sourceFileFor(filePath);
    const aliasMap = new Map<string, string>();
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "@tailor-platform/sdk"
      ) {
        continue;
      }
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        if (element.propertyName) {
          aliasMap.set(element.name.text, element.propertyName.text);
        }
      }
    }
    if (aliasMap.size > 0) result.set(file, aliasMap);
  }
  return result;
}

// Rewrite `tailorDb.type(...)` back to `db.type(...)` so user-chosen aliases do not
// hide otherwise-valid API usage from required/forbidden pattern checks. Uses a
// function replacer so the exported name is treated as a literal string, even if
// it ever contains regex specials like `$&`.
function rewriteSdkAliases(source: string, aliases: Map<string, string>): string {
  let out = source;
  for (const [local, exported] of aliases) {
    out = out.replace(new RegExp(`\\b${local}\\b`, "g"), () => exported);
  }
  return out;
}

function collectSdkImports(workDir: string, files: string[]): SdkImportSummary {
  const imports: SdkImport[] = [];
  let hasNamespaceImport = false;
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
      if (!bindings) {
        continue;
      }
      if (ts.isNamespaceImport(bindings)) {
        // `import * as sdk from "@tailor-platform/sdk"` — call sites use sdk.x.
        // We do not analyze member access, so import-shape checks are skipped below.
        hasNamespaceImport = true;
        continue;
      }
      if (!ts.isNamedImports(bindings)) {
        continue;
      }
      for (const element of bindings.elements) {
        // Resolve to the exported name; element.propertyName is set when aliased
        // (`import { db as tailorDb }` → propertyName=db, name=tailorDb).
        imports.push({ file, symbol: (element.propertyName ?? element.name).text });
      }
    }
  }
  return { imports, hasNamespaceImport };
}

function checkRequiredSdkImports(
  importedSymbols: Set<string>,
  config: ApiCheckConfig,
  hasNamespaceImport: boolean,
): CheckResult[] {
  return (config.requiredSdkImports ?? []).map((symbol) => {
    const namedHit = importedSymbols.has(symbol);
    // A namespace import (`import * as sdk`) brings every export into scope, so
    // required-symbol presence cannot be denied. Forbidden / unknown checks still
    // evaluate the collected named imports.
    const passed = namedHit || hasNamespaceImport;
    return {
      name: `required-sdk-import:${symbol}`,
      passed,
      message: passed
        ? namedHit
          ? `Found required @tailor-platform/sdk import: ${symbol}`
          : `Required @tailor-platform/sdk import satisfied via namespace: ${symbol}`
        : `Missing required @tailor-platform/sdk import: ${symbol}`,
    };
  });
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
  searchScope: ApiCheckPattern["searchScope"],
  fileAliases: FileSdkAliases,
): string {
  const targetFiles = files ?? implementFiles;
  return targetFiles
    .map((file) => {
      const filePath = path.join(workDir, file);
      if (!fs.existsSync(filePath)) return "";
      const raw = fs.readFileSync(filePath, "utf-8");
      const text = searchScope === "raw" ? raw : stripCommentsAndStringBodies(raw);
      const aliases = fileAliases.get(file);
      return aliases && aliases.size > 0 ? rewriteSdkAliases(text, aliases) : text;
    })
    .join("\n");
}

function checkRequiredPatterns(
  workDir: string,
  patterns: ApiCheckPattern[] | undefined,
  implementFiles: string[],
  fileAliases: FileSdkAliases,
): CheckResult[] {
  return (patterns ?? []).map((item) => {
    const source = readCandidateSource(
      workDir,
      item.files,
      implementFiles,
      item.searchScope,
      fileAliases,
    );
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
  fileAliases: FileSdkAliases,
): CheckResult[] {
  return (patterns ?? []).map((item) => {
    const source = readCandidateSource(
      workDir,
      item.files,
      implementFiles,
      item.searchScope,
      fileAliases,
    );
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

  const { imports, hasNamespaceImport } = collectSdkImports(workDir, meta.files.implement);
  const importedSymbols = new Set(imports.map((item) => item.symbol));
  const publicExports = collectPublicSdkExports(workDir, challengeRoot);
  const fileAliases = collectSdkAliasesByFile(workDir, meta.files.implement);
  // Namespace imports (`import * as sdk from "@tailor-platform/sdk"`) bring every
  // export into scope, so required-symbol checks pass through them. Forbidden and
  // unknown checks still evaluate the collected named imports so a submission that
  // mixes `import * as sdk` with `import { createResolver }` cannot bypass scoring.
  const checks = [
    ...checkUnknownSdkImports(imports, publicExports, meta.apiCheck),
    ...checkRequiredSdkImports(importedSymbols, meta.apiCheck, hasNamespaceImport),
    ...checkForbiddenSdkImports(importedSymbols, meta.apiCheck),
    ...checkRequiredPatterns(
      workDir,
      meta.apiCheck.requiredPatterns,
      meta.files.implement,
      fileAliases,
    ),
    ...checkForbiddenPatterns(
      workDir,
      meta.apiCheck.forbiddenPatterns,
      meta.files.implement,
      fileAliases,
    ),
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
