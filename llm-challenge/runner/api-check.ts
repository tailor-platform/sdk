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
  // Local names bound to `import * as <name> from "@tailor-platform/sdk"`,
  // grouped by file so an alias declared in one file does not leak into another.
  namespaceAliasesByFile: Map<string, string[]>;
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
    out = out.replace(new RegExp(`\\b${escapeRegExp(local)}\\b`, "g"), () => exported);
  }
  return out;
}

// Strip namespace prefixes (`sdk.db.type` → `db.type`) so patterns expressed against
// the exported names (`db\.type\(`) still match valid namespace-import submissions.
function stripNamespacePrefix(source: string, namespaceAliases: string[]): string {
  let out = source;
  for (const alias of namespaceAliases) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(alias)}\\.`, "g"), () => "");
  }
  return out;
}

/**
 * Inline assignments of `db.<field>(...)` chains into their later uses so a
 * forbidden chain cannot be hidden behind a temporary, e.g.
 *   const slugBase = db.string().unique();
 *   const slug = slugBase.hooks({ ... });
 * becomes
 *   ...
 *   const slug = db.string().unique().hooks({ ... });
 * for pattern matching only. Same-file scope, simple `const X = <chain>;` cases.
 */
function inlineDbFieldChainAliases(source: string): string {
  const sourceFile = ts.createSourceFile("__inline__.ts", source, ts.ScriptTarget.Latest, true);
  const aliases = new Map<string, string>();
  const dbFieldChainStarter = /^db\s*\.(?!type\b)\w+\(/;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const text = node.initializer.getText(sourceFile).trim();
      if (dbFieldChainStarter.test(text)) {
        aliases.set(node.name.text, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (aliases.size === 0) return source;

  let out = source;
  for (const [local, expansion] of aliases) {
    // Replace standalone identifier occurrences only, never substring matches.
    out = out.replace(new RegExp(`\\b${escapeRegExp(local)}\\b`, "g"), () => expansion);
  }
  return out;
}

/**
 * Unwrap trivial parentheses around chained call expressions, e.g.
 * `(db.string().unique()).hooks(...)` → `db.string().unique().hooks(...)`. This is
 * narrowly intended to defeat paren-based bypasses of pattern checks; it is not a
 * general expression unwrapper. Iterates until a fixed point.
 */
function unwrapTrivialParens(source: string): string {
  const re = /\(\s*((?:\w+(?:\([^()]*\))?(?:\s*\.\s*\w+(?:\([^()]*\))?)*)\s*)\)/g;
  let prev = "";
  let cur = source;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(re, (_match, inner: string) => inner);
  }
  return cur;
}

function collectSdkImports(workDir: string, files: string[]): SdkImportSummary {
  const imports: SdkImport[] = [];
  const namespaceAliasesByFile = new Map<string, string[]>();
  let hasNamespaceImport = false;
  for (const file of files) {
    const filePath = path.join(workDir, file);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const source = sourceFileFor(filePath);
    const fileNamespaceAliases: string[] = [];
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
        // `import * as sdk from "@tailor-platform/sdk"` — record the local alias
        // so forbidden symbol usage like `sdk.createExecutor` can still be flagged.
        hasNamespaceImport = true;
        fileNamespaceAliases.push(bindings.name.text);
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
    if (fileNamespaceAliases.length > 0) {
      namespaceAliasesByFile.set(file, fileNamespaceAliases);
    }
  }
  return { imports, hasNamespaceImport, namespaceAliasesByFile };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect forbidden SDK symbols that are used through a namespace import alias.
 * Walks the AST so that direct (`sdk.createExecutor`), computed
 * (`sdk["createExecutor"]`), and destructuring (`const { createExecutor } = sdk`)
 * forms are all caught — relying on string grep would miss the bracket form
 * once string bodies are blanked elsewhere.
 */
function findNamespaceForbiddenUsages(
  workDir: string,
  files: string[],
  namespaceAliasesByFile: Map<string, string[]>,
  forbiddenSymbols: string[],
): Set<string> {
  const found = new Set<string>();
  if (namespaceAliasesByFile.size === 0 || forbiddenSymbols.length === 0) {
    return found;
  }
  const forbiddenSet = new Set(forbiddenSymbols);

  for (const file of files) {
    const fileAliases = namespaceAliasesByFile.get(file);
    if (!fileAliases || fileAliases.length === 0) continue;
    const aliasSet = new Set(fileAliases);
    const isAliasIdentifier = (node: ts.Node): node is ts.Identifier =>
      ts.isIdentifier(node) && aliasSet.has(node.text);

    const filePath = path.join(workDir, file);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      // sdk.createExecutor
      if (
        ts.isPropertyAccessExpression(node) &&
        isAliasIdentifier(node.expression) &&
        forbiddenSet.has(node.name.text)
      ) {
        found.add(node.name.text);
      }
      // sdk["createExecutor"]
      if (
        ts.isElementAccessExpression(node) &&
        isAliasIdentifier(node.expression) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        forbiddenSet.has(node.argumentExpression.text)
      ) {
        found.add(node.argumentExpression.text);
      }
      // const { createExecutor } = sdk;  (also handles `{ a: b } = sdk` rename)
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        isAliasIdentifier(node.initializer)
      ) {
        for (const element of node.name.elements) {
          const exportedName =
            element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : ts.isIdentifier(element.name)
                ? element.name.text
                : undefined;
          if (exportedName && forbiddenSet.has(exportedName)) {
            found.add(exportedName);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
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
  namespaceUsages: Set<string>,
): CheckResult[] {
  return (config.forbiddenSdkImports ?? []).map((symbol) => {
    const named = importedSymbols.has(symbol);
    const namespaced = namespaceUsages.has(symbol);
    const passed = !named && !namespaced;
    let message: string;
    if (passed) {
      message = `Did not find forbidden @tailor-platform/sdk import: ${symbol}`;
    } else if (named) {
      message = `Forbidden @tailor-platform/sdk import: ${symbol}`;
    } else {
      message = `Forbidden @tailor-platform/sdk usage via namespace import: ${symbol}`;
    }
    return {
      name: `forbidden-sdk-import:${symbol}`,
      passed,
      message,
    };
  });
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
  namespaceAliasesByFile: Map<string, string[]>,
): string {
  const targetFiles = files ?? implementFiles;
  return targetFiles
    .map((file) => {
      const filePath = path.join(workDir, file);
      if (!fs.existsSync(filePath)) return "";
      const raw = fs.readFileSync(filePath, "utf-8");
      // Raw mode is documented as verbatim — alias rewriting must not mutate the
      // string contents (e.g. an alias that happens to appear inside a forbidden
      // package literal would otherwise be rewritten and miss the match).
      if (searchScope === "raw") return raw;
      let text = stripCommentsAndStringBodies(raw);
      const aliases = fileAliases.get(file);
      if (aliases && aliases.size > 0) text = rewriteSdkAliases(text, aliases);
      const fileNamespaceAliases = namespaceAliasesByFile.get(file);
      if (fileNamespaceAliases && fileNamespaceAliases.length > 0) {
        text = stripNamespacePrefix(text, fileNamespaceAliases);
      }
      text = inlineDbFieldChainAliases(text);
      text = unwrapTrivialParens(text);
      return text;
    })
    .join("\n");
}

function checkPatterns(
  kind: "required" | "forbidden",
  workDir: string,
  patterns: ApiCheckPattern[] | undefined,
  implementFiles: string[],
  fileAliases: FileSdkAliases,
  namespaceAliasesByFile: Map<string, string[]>,
): CheckResult[] {
  return (patterns ?? []).map((item) => {
    const source = readCandidateSource(
      workDir,
      item.files,
      implementFiles,
      item.searchScope,
      fileAliases,
      namespaceAliasesByFile,
    );
    const matched = new RegExp(item.pattern, "m").test(source);
    const passed = kind === "required" ? matched : !matched;
    const passMessage =
      kind === "required"
        ? `Found required pattern: ${item.name}`
        : `Did not find forbidden pattern: ${item.name}`;
    const failMessage =
      item.message ??
      (kind === "required"
        ? `Missing required pattern: ${item.name}`
        : `Forbidden pattern matched: ${item.name}`);
    return {
      name: `${kind}-pattern:${item.name}`,
      passed,
      message: passed ? passMessage : failMessage,
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

  const { imports, hasNamespaceImport, namespaceAliasesByFile } = collectSdkImports(
    workDir,
    meta.files.implement,
  );
  const importedSymbols = new Set(imports.map((item) => item.symbol));
  const publicExports = collectPublicSdkExports(workDir, challengeRoot);
  const fileAliases = collectSdkAliasesByFile(workDir, meta.files.implement);
  const namespaceForbiddenUsages = findNamespaceForbiddenUsages(
    workDir,
    meta.files.implement,
    namespaceAliasesByFile,
    meta.apiCheck.forbiddenSdkImports ?? [],
  );
  // Namespace imports (`import * as sdk from "@tailor-platform/sdk"`) bring every
  // export into scope, so required-symbol checks pass through them. Forbidden checks
  // still evaluate the collected named imports plus `<namespaceAlias>.<symbol>` usage
  // so a submission cannot bypass scoring by routing forbidden APIs through a
  // namespace alias. Unknown checks only see explicit named imports.
  const checks = [
    ...checkUnknownSdkImports(imports, publicExports, meta.apiCheck),
    ...checkRequiredSdkImports(importedSymbols, meta.apiCheck, hasNamespaceImport),
    ...checkForbiddenSdkImports(importedSymbols, meta.apiCheck, namespaceForbiddenUsages),
    ...checkPatterns(
      "required",
      workDir,
      meta.apiCheck.requiredPatterns,
      meta.files.implement,
      fileAliases,
      namespaceAliasesByFile,
    ),
    ...checkPatterns(
      "forbidden",
      workDir,
      meta.apiCheck.forbiddenPatterns,
      meta.files.implement,
      fileAliases,
      namespaceAliasesByFile,
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
