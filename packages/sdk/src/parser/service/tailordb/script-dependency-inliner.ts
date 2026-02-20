import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Linter } from "eslint";
import * as globals from "globals";
import { parseSync } from "oxc-parser";
import type {
  Program,
  Statement,
  VariableDeclaration,
  VariableDeclarator,
} from "@oxc-project/types";

type ScriptKind = "hook.create" | "hook.update" | "validate";

interface ParsedDeclaration {
  kind: "const" | "function";
  name: string;
  source: string;
  analysisExpr: string;
}

interface SourceDeclarationMap {
  declarations: Map<string, ParsedDeclaration>;
  imports: Map<string, { importedName: string; source: string }>;
  exports: Map<string, string>;
}

interface DependencyResolution {
  declarations: string[];
  unresolved: string[];
}

// TailorDB script runtime variables (injected at runtime)
const tailordbRuntimeGlobals: Linter.Globals = {
  _value: "readonly",
  _data: "readonly",
  _user: "readonly",
  user: "readonly",
};

const declarationCache = new Map<string, SourceDeclarationMap>();

const linter = new Linter();
const typeSyntaxKeys = new Set(["typeAnnotation", "typeParameters", "returnType"]);

function collectUndefinedIdentifiers(code: string, extraGlobals: Linter.Globals = {}): string[] {
  if (!code.trim()) return [];

  const messages = linter.verify(
    code,
    {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        globals: {
          ...globals.builtin,
          console: "readonly",
          ...tailordbRuntimeGlobals,
          ...extraGlobals,
        },
      },
      rules: {
        "no-undef": "error",
      },
    },
    {
      filename: "tailordb-script.js",
    },
  );

  const names = new Set<string>();
  for (const message of messages) {
    const match = message.message.match(/'([^']+)' is not defined/);
    if (match) {
      names.add(match[1]);
    }
  }
  return [...names];
}

function stripRanges(source: string, ranges: Array<{ start: number; end: number }>): string {
  if (ranges.length === 0) return source;

  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  let result = source;
  for (const range of sorted) {
    result = result.slice(0, range.start) + result.slice(range.end);
  }
  return result;
}

function collectTypeSyntaxRanges(node: unknown, ranges: Array<{ start: number; end: number }>) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectTypeSyntaxRanges(item, ranges);
    }
    return;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (
      typeSyntaxKeys.has(key) &&
      value &&
      typeof value === "object" &&
      "start" in value &&
      "end" in value
    ) {
      const typedNode = value as { start: number; end: number };
      ranges.push({ start: typedNode.start, end: typedNode.end });
      continue;
    }
    collectTypeSyntaxRanges(value, ranges);
  }
}

function getJavaScriptSourceFromNode(source: string, node: { start: number; end: number }): string {
  const raw = source.slice(node.start, node.end);
  const ranges: Array<{ start: number; end: number }> = [];
  collectTypeSyntaxRanges(node, ranges);
  const localRanges = ranges.map((range) => ({
    start: range.start - node.start,
    end: range.end - node.start,
  }));
  return stripRanges(raw, localRanges).trim();
}

function parseVariableDeclarator(
  source: string,
  decl: VariableDeclarator,
): ParsedDeclaration | undefined {
  if (decl.id.type !== "Identifier" || !decl.init) {
    return undefined;
  }

  const name = decl.id.name;
  const initSource = getJavaScriptSourceFromNode(source, decl.init);
  return {
    kind: "const",
    name,
    source: `const ${name} = ${initSource};`,
    analysisExpr: `(${initSource})`,
  };
}

function parseTopLevelDeclaration(source: string, statement: Statement): ParsedDeclaration[] {
  if (statement.type === "VariableDeclaration") {
    const variableDecl = statement as VariableDeclaration;
    return variableDecl.declarations
      .map((decl) => parseVariableDeclarator(source, decl))
      .filter((decl): decl is ParsedDeclaration => !!decl);
  }

  if (statement.type === "FunctionDeclaration") {
    const functionDecl = statement as Statement & {
      id?: { name: string };
      start: number;
      end: number;
    };
    if (!functionDecl.id) return [];

    const sourceText = getJavaScriptSourceFromNode(source, functionDecl);
    return [
      {
        kind: "function",
        name: functionDecl.id.name,
        source: sourceText,
        analysisExpr: `(${sourceText})`,
      },
    ];
  }

  return [];
}

function getIdentifierName(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const typedNode = node as { type?: string; name?: string; value?: unknown };
  if (typedNode.type === "Identifier" && typeof typedNode.name === "string") {
    return typedNode.name;
  }
  if (typedNode.type === "Literal" && typeof typedNode.value === "string") {
    return typedNode.value;
  }
  return undefined;
}

function parseImportDeclarations(statement: Statement, imports: SourceDeclarationMap["imports"]) {
  if (statement.type !== "ImportDeclaration") return;

  const importDecl = statement as Statement & {
    source: { value?: unknown };
    specifiers?: Array<{
      type: string;
      importKind?: string;
      imported?: unknown;
      local?: unknown;
    }>;
  };

  if (typeof importDecl.source?.value !== "string") return;
  const source = importDecl.source.value;
  if (!source.startsWith("./") && !source.startsWith("../")) return;

  for (const specifier of importDecl.specifiers ?? []) {
    if (specifier.type !== "ImportSpecifier") continue;
    if (specifier.importKind && specifier.importKind !== "value") continue;
    const importedName = getIdentifierName(specifier.imported);
    const localName = getIdentifierName(specifier.local);
    if (!importedName || !localName) continue;
    imports.set(localName, { importedName, source });
  }
}

function parseExportDeclarations(
  sourceCode: string,
  statement: Statement,
  declarations: SourceDeclarationMap["declarations"],
  exportsMap: SourceDeclarationMap["exports"],
) {
  if (statement.type !== "ExportNamedDeclaration") return;

  const exportDecl = statement as Statement & {
    declaration?: Statement | null;
    source?: { value?: unknown } | null;
    specifiers?: Array<{ local?: unknown; exported?: unknown; exportKind?: string }>;
  };

  if (exportDecl.declaration) {
    for (const declaration of parseTopLevelDeclaration(sourceCode, exportDecl.declaration)) {
      declarations.set(declaration.name, declaration);
      exportsMap.set(declaration.name, declaration.name);
    }
    return;
  }

  // Skip re-export statements: export { x } from "./module"
  if (typeof exportDecl.source?.value === "string") return;

  for (const specifier of exportDecl.specifiers ?? []) {
    if (specifier.exportKind && specifier.exportKind !== "value") continue;
    const localName = getIdentifierName(specifier.local);
    const exportedName = getIdentifierName(specifier.exported);
    if (!localName || !exportedName) continue;
    exportsMap.set(exportedName, localName);
  }
}

function resolveRelativeImportPath(fromFilePath: string, importSource: string): string | undefined {
  if (!importSource.startsWith("./") && !importSource.startsWith("../")) return undefined;

  const basePath = resolve(dirname(fromFilePath), importSource);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    join(basePath, "index.ts"),
    join(basePath, "index.tsx"),
    join(basePath, "index.js"),
    join(basePath, "index.mjs"),
    join(basePath, "index.cjs"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTranspiledImportBinding(name: string): boolean {
  return name.startsWith("__vite_ssr_import_") || /^__\w*import\w*__$/i.test(name);
}

function extractMemberDependencies(functionSource: string, objectName: string): string[] {
  const propertyNames = new Set<string>();
  const dotPattern = new RegExp(
    String.raw`\b${escapeRegExp(objectName)}\.([A-Za-z_$][A-Za-z0-9_$]*)`,
    "g",
  );
  const bracketPattern = new RegExp(
    String.raw`\b${escapeRegExp(objectName)}\[['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]\]`,
    "g",
  );

  for (const match of functionSource.matchAll(dotPattern)) {
    if (match[1]) {
      propertyNames.add(match[1]);
    }
  }
  for (const match of functionSource.matchAll(bracketPattern)) {
    if (match[1]) {
      propertyNames.add(match[1]);
    }
  }
  return [...propertyNames];
}

function getSourceDeclarationMap(filePath: string): SourceDeclarationMap | undefined {
  const cached = declarationCache.get(filePath);
  if (cached) return cached;

  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }

  let program: Program;
  try {
    ({ program } = parseSync(filePath, source));
  } catch {
    return undefined;
  }

  const declarations = new Map<string, ParsedDeclaration>();
  const imports = new Map<string, { importedName: string; source: string }>();
  const exportsMap = new Map<string, string>();

  for (const statement of program.body) {
    parseImportDeclarations(statement, imports);
    parseExportDeclarations(source, statement, declarations, exportsMap);

    for (const declaration of parseTopLevelDeclaration(source, statement)) {
      declarations.set(declaration.name, declaration);
    }
  }

  // Allow direct lookup by local declaration name when imported file omits explicit export mapping.
  for (const name of declarations.keys()) {
    if (!exportsMap.has(name)) {
      exportsMap.set(name, name);
    }
  }

  const result: SourceDeclarationMap = { declarations, imports, exports: exportsMap };
  declarationCache.set(filePath, result);
  return result;
}

function resolveDependencies(functionSource: string, rootFilePath: string): DependencyResolution {
  const orderedDeclarationSource: string[] = [];
  const unresolved = new Set<string>();
  const visiting = new Set<string>();
  const added = new Set<string>();

  const findImportBinding = (
    sourceMap: SourceDeclarationMap,
    name: string,
  ): { importedName: string; source: string } | undefined => {
    const direct = sourceMap.imports.get(name);
    if (direct) return direct;

    for (const imported of sourceMap.imports.values()) {
      if (imported.importedName === name) {
        return imported;
      }
    }
    return undefined;
  };

  const resolveName = (filePath: string, name: string) => {
    const sourceMap = getSourceDeclarationMap(filePath);
    if (!sourceMap) {
      unresolved.add(name);
      return;
    }

    let targetFilePath = filePath;
    let targetName = name;
    let targetSourceMap = sourceMap;

    if (!targetSourceMap.declarations.has(targetName)) {
      const imported = findImportBinding(targetSourceMap, targetName);
      if (!imported) {
        unresolved.add(name);
        return;
      }
      const importedFilePath = resolveRelativeImportPath(filePath, imported.source);
      if (!importedFilePath) {
        unresolved.add(name);
        return;
      }
      const importedSourceMap = getSourceDeclarationMap(importedFilePath);
      if (!importedSourceMap) {
        unresolved.add(name);
        return;
      }
      const exportedLocalName =
        importedSourceMap.exports.get(imported.importedName) ?? imported.importedName;
      targetFilePath = importedFilePath;
      targetName = exportedLocalName;
      targetSourceMap = importedSourceMap;
    }

    const key = `${targetFilePath}::${targetName}`;
    if (added.has(key) || visiting.has(key)) return;

    const declaration = targetSourceMap.declarations.get(targetName);
    if (!declaration) {
      unresolved.add(name);
      return;
    }

    visiting.add(key);
    const dependencies = collectUndefinedIdentifiers(declaration.analysisExpr);
    for (const dependency of dependencies) {
      resolveName(targetFilePath, dependency);
    }
    visiting.delete(key);
    added.add(key);
    orderedDeclarationSource.push(declaration.source);
  };

  const functionDependencies = collectUndefinedIdentifiers(`(${functionSource})`);
  for (const dependency of functionDependencies) {
    if (isTranspiledImportBinding(dependency)) {
      const memberDependencies = extractMemberDependencies(functionSource, dependency);
      if (memberDependencies.length > 0) {
        for (const memberDependency of memberDependencies) {
          resolveName(rootFilePath, memberDependency);
        }
        continue;
      }
    }
    resolveName(rootFilePath, dependency);
  }

  return {
    declarations: orderedDeclarationSource,
    unresolved: [...unresolved],
  };
}

function buildScriptInvocation(functionSource: string): string {
  return `(${functionSource})({ value: _value, data: _data, user: { id: user.id, type: user.type, workspaceId: user.workspace_id, attributes: user.attribute_map, attributeList: user.attributes } })`;
}

function inlineByFileSource(functionSource: string, filePath: string): DependencyResolution {
  if (!getSourceDeclarationMap(filePath)) {
    return { declarations: [], unresolved: [] };
  }
  return resolveDependencies(functionSource, filePath);
}

/**
 * Build a TailorDB script expression and inline top-level source declarations when possible.
 * @param functionSource - Hook/validate function source code text.
 * @param _kind - Script kind for future behavior branching.
 * @param sourceFilePath - Absolute source file path used for declaration lookup.
 * @returns Script expression string. Falls back to direct invocation when inlining is unavailable.
 */
export function buildScriptExprWithInlineDependencies(
  functionSource: string,
  _kind: ScriptKind,
  sourceFilePath?: string,
): string {
  const invocation = buildScriptInvocation(functionSource);
  if (!sourceFilePath) {
    return invocation;
  }

  const dependencies = inlineByFileSource(functionSource, sourceFilePath);
  if (dependencies.declarations.length === 0) {
    return invocation;
  }

  if (dependencies.unresolved.length > 0) {
    return invocation;
  }

  console.log("👍expr is ");
  console.log(
    `(() => {\n${dependencies.declarations.map((d) => `  ${d}`).join("\n")}\n  return ${invocation};\n})()`,
  );

  return `(() => {\n${dependencies.declarations.map((d) => `  ${d}`).join("\n")}\n  return ${invocation};\n})()`;
}
