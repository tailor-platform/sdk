import { readFileSync } from "node:fs";
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

function collectTypeSyntaxRanges(
  node: unknown,
  ranges: Array<{ start: number; end: number }>,
): void {
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
  for (const statement of program.body) {
    for (const declaration of parseTopLevelDeclaration(source, statement)) {
      declarations.set(declaration.name, declaration);
    }
  }

  const result: SourceDeclarationMap = { declarations };
  declarationCache.set(filePath, result);
  return result;
}

function resolveDependencies(
  functionSource: string,
  declarationMap: SourceDeclarationMap,
): DependencyResolution {
  const orderedDeclarationSource: string[] = [];
  const unresolved = new Set<string>();
  const visiting = new Set<string>();
  const added = new Set<string>();

  const resolveName = (name: string): void => {
    if (added.has(name) || visiting.has(name)) return;
    const declaration = declarationMap.declarations.get(name);
    if (!declaration) {
      unresolved.add(name);
      return;
    }

    visiting.add(name);
    const dependencies = collectUndefinedIdentifiers(declaration.analysisExpr);
    for (const dependency of dependencies) {
      resolveName(dependency);
    }
    visiting.delete(name);
    added.add(name);
    orderedDeclarationSource.push(declaration.source);
  };

  const functionDependencies = collectUndefinedIdentifiers(`(${functionSource})`);
  for (const dependency of functionDependencies) {
    resolveName(dependency);
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
  const declarationMap = getSourceDeclarationMap(filePath);
  if (!declarationMap) {
    return { declarations: [], unresolved: [] };
  }
  return resolveDependencies(functionSource, declarationMap);
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

  return `(() => {\n${dependencies.declarations.map((d) => `  ${d}`).join("\n")}\n  return ${invocation};\n})()`;
}
