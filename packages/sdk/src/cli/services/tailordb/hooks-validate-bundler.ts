import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parseSync } from "oxc-parser";
import { join, resolve } from "pathe";
import * as rolldown from "rolldown";
import { getDistDir } from "#/cli/shared/dist-dir";
import { platformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { stringifyFunction, tailorPrincipalMap } from "#/parser/service/tailordb/field";
import { setPrecompiledScriptExpr } from "#/parser/service/tailordb/hooks-validate-precompiled-expr";
import { assertDefined } from "#/utils/assert";
import { assertParsableExpression } from "#/utils/script-expr";
import { ES_BUILTINS } from "./es-builtins";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";
import type {
  BindingPattern,
  ExportNamedDeclaration,
  Function as OxcFunction,
  ImportDeclaration,
  Node,
  ParamPattern,
  VariableDeclaration,
} from "@oxc-project/types";

type ScriptFunction = (...args: unknown[]) => unknown;

type ScriptTarget = {
  fn: ScriptFunction;
  kind: "hooks" | "validate" | "typeHook" | "typeValidate";
};

/** Binding found in the source file: either an import or a top-level declaration */
export type SourceBinding = {
  name: string;
  /** The original source text of the import/declaration statement */
  sourceText: string;
  kind: "import" | "declaration";
};

/**
 * Recursively extract binding names from a destructuring pattern node.
 * @param pattern - The binding pattern AST node.
 * @param bindings - Set to collect binding names into.
 */
function collectBindingsFromPattern(pattern: BindingPattern, bindings: Set<string>): void {
  switch (pattern.type) {
    case "Identifier":
      bindings.add(pattern.name);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") {
          collectBindingsFromPattern(prop.argument, bindings);
        } else {
          collectBindingsFromPattern(prop.value, bindings);
        }
      }
      break;
    case "ArrayPattern":
      for (const elem of pattern.elements) {
        if (elem) {
          if (elem.type === "RestElement") {
            collectBindingsFromPattern(elem.argument, bindings);
          } else {
            collectBindingsFromPattern(elem, bindings);
          }
        }
      }
      break;
    case "AssignmentPattern":
      collectBindingsFromPattern(pattern.left, bindings);
      break;
  }
}

/** Fields that contain TypeScript type annotations (not runtime references). */
const TS_TYPE_FIELDS = new Set([
  "typeAnnotation",
  "typeParameters",
  "returnType",
  "superTypeArguments",
  "typeArguments",
]);

function isBindingPattern(param: ParamPattern): param is BindingPattern {
  return param.type !== "TSParameterProperty";
}

function toScriptFunction(value: unknown): ScriptFunction | undefined {
  if (typeof value !== "function") return undefined;
  return value as unknown as ScriptFunction;
}

function collectScriptTargets(type: TailorDBTypeSchemaOutput): ScriptTarget[] {
  const targets: ScriptTarget[] = [];

  const collectFieldTargets = (field: TailorDBTypeSchemaOutput["fields"][string]) => {
    const metadata = field.metadata;

    const createHook = toScriptFunction(metadata.hooks?.create);
    if (createHook) {
      targets.push({ fn: createHook, kind: "hooks" });
    }
    const updateHook = toScriptFunction(metadata.hooks?.update);
    if (updateHook) {
      targets.push({ fn: updateHook, kind: "hooks" });
    }

    for (const validateInput of metadata.validate ?? []) {
      const validateFn = toScriptFunction(validateInput);
      if (validateFn) targets.push({ fn: validateFn, kind: "validate" });
    }

    if (field.type === "nested" && field.fields) {
      for (const nestedField of Object.values(field.fields as TailorDBTypeSchemaOutput["fields"])) {
        collectFieldTargets(nestedField);
      }
    }
  };

  for (const field of Object.values(type.fields)) {
    collectFieldTargets(field);
  }

  if (type.metadata.typeHook) {
    for (const op of ["create", "update"] as const) {
      const fn = toScriptFunction(type.metadata.typeHook[op]);
      if (fn) {
        targets.push({ fn, kind: "typeHook" });
      }
    }
  }

  const typeValidateFn = toScriptFunction(type.metadata.typeValidate);
  if (typeValidateFn) {
    targets.push({ fn: typeValidateFn, kind: "typeValidate" });
  }

  return targets;
}

/**
 * Parse a code string with oxc-parser and return identifiers that are referenced
 * but never bound anywhere in the snippet (free variables), excluding ES builtins.
 * @param code - Valid JavaScript code to analyze.
 * @returns Set of undefined variable names.
 */
export function findUndefinedReferences(code: string): Set<string> {
  const { program } = parseSync("_.js", code);
  const references = new Set<string>();
  const bindings = new Set<string>();

  const walk = (node: Node | null | undefined): void => {
    if (!node) return;

    switch (node.type) {
      case "VariableDeclarator":
        collectBindingsFromPattern(node.id, bindings);
        walk(node.init);
        return;

      case "FunctionDeclaration":
      case "FunctionExpression":
        if (node.id) bindings.add(node.id.name);
        for (const param of node.params) {
          if (isBindingPattern(param)) {
            collectBindingsFromPattern(param, bindings);
            walk(param);
          }
        }
        walk(node.body);
        return;

      case "ArrowFunctionExpression":
        for (const param of node.params) {
          if (isBindingPattern(param)) {
            collectBindingsFromPattern(param, bindings);
            walk(param);
          }
        }
        walk(node.body);
        return;

      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) bindings.add(node.id.name);
        walk(node.superClass);
        walk(node.body);
        return;

      case "CatchClause":
        if (node.param) collectBindingsFromPattern(node.param, bindings);
        walk(node.body);
        return;

      case "MemberExpression":
        walk(node.object);
        if (node.computed) walk(node.property);
        return;

      case "Property":
        if (node.computed) walk(node.key);
        walk(node.value);
        return;

      case "LabeledStatement":
        walk(node.body);
        return;

      case "Identifier":
        references.add(node.name);
        return;
    }

    // Generic child walk for all other node types, skipping TS type-annotation fields
    const rec = node as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(rec)) {
      if (key === "type" || TS_TYPE_FIELDS.has(key)) continue;
      if (Array.isArray(value)) {
        for (const item of value) walk(item as Node);
      } else if (value && typeof value === "object" && "type" in value) {
        walk(value as Node);
      }
    }
  };

  walk(program);

  // Free variables = references - bindings - builtins
  const freeVars = new Set<string>();
  for (const ref of references) {
    if (!bindings.has(ref) && !ES_BUILTINS.has(ref)) {
      freeVars.add(ref);
    }
  }
  return freeVars;
}

/**
 * Collect all Identifier names from a TypeScript/JavaScript code string using oxc-parser.
 * @param code - Code string to analyze.
 * @returns Set of identifier names found in the code.
 */
function collectIdentifierNames(code: string): Set<string> {
  const { program } = parseSync("_.ts", code);
  const names = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.type === "Identifier" && typeof record.name === "string") {
      names.add(record.name);
    }
    for (const [key, value] of Object.entries(record)) {
      // Skip non-computed MemberExpression property (e.g. `length` in `value.length`)
      // but keep computed properties (e.g. `foo` in `obj[foo]`) as they are real references
      if (key === "property" && record.type === "MemberExpression" && !record.computed) continue;
      // Skip non-computed Property keys (e.g. `format` in `{ format: "x" }` is not a reference)
      if (key === "key" && record.type === "Property" && !record.computed) continue;
      // Skip TypeScript type annotation fields (not runtime references)
      if (TS_TYPE_FIELDS.has(key)) continue;
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
      } else if (value && typeof value === "object" && "type" in value) {
        walk(value);
      }
    }
  };
  walk(program);
  return names;
}

/**
 * Collect top-level bindings (imports and declarations) from a TypeScript source file.
 * @param sourceFilePath - Absolute path to the source file.
 * @returns Map of binding name to SourceBinding.
 */
export function collectSourceBindings(sourceFilePath: string): Map<string, SourceBinding> {
  const source = readFileSync(sourceFilePath, "utf-8");
  const { program } = parseSync(sourceFilePath, source);
  const bindings = new Map<string, SourceBinding>();

  for (const stmt of program.body) {
    if (stmt.type === "ImportDeclaration") {
      const importDecl = stmt as ImportDeclaration;
      const text = source.slice(importDecl.start, importDecl.end);
      for (const spec of importDecl.specifiers) {
        bindings.set(spec.local.name, {
          name: spec.local.name,
          sourceText: text,
          kind: "import",
        });
      }
    } else if (stmt.type === "VariableDeclaration") {
      const varDecl = stmt as VariableDeclaration;
      const text = source.slice(varDecl.start, varDecl.end);
      for (const decl of varDecl.declarations) {
        if (decl.id.type === "Identifier") {
          bindings.set(decl.id.name, { name: decl.id.name, sourceText: text, kind: "declaration" });
        }
      }
    } else if (stmt.type === "FunctionDeclaration") {
      const funcDecl = stmt as OxcFunction;
      if (funcDecl.id) {
        const text = source.slice(funcDecl.start, funcDecl.end);
        bindings.set(funcDecl.id.name, {
          name: funcDecl.id.name,
          sourceText: text,
          kind: "declaration",
        });
      }
    } else if (stmt.type === "ExportNamedDeclaration") {
      const exportDecl = stmt as ExportNamedDeclaration;
      const innerDecl = exportDecl.declaration;
      if (!innerDecl) continue;

      if (innerDecl.type === "VariableDeclaration") {
        const varDecl = innerDecl as VariableDeclaration;
        // Slice only the inner declaration (without export keyword) so it is valid standalone
        const text = source.slice(varDecl.start, varDecl.end);
        for (const decl of varDecl.declarations) {
          if (decl.id.type === "Identifier") {
            bindings.set(decl.id.name, {
              name: decl.id.name,
              sourceText: text,
              kind: "declaration",
            });
          }
        }
      } else if (innerDecl.type === "FunctionDeclaration") {
        const funcDecl = innerDecl as OxcFunction;
        if (funcDecl.id) {
          const text = source.slice(funcDecl.start, funcDecl.end);
          bindings.set(funcDecl.id.name, {
            name: funcDecl.id.name,
            sourceText: text,
            kind: "declaration",
          });
        }
      }
    }
  }

  return bindings;
}

/**
 * Resolve all bindings needed by a function, recursively including
 * dependencies of top-level declarations.
 * @param freeVars - Set of free variable names extracted from the function.
 * @param sourceBindings - Available bindings from the source file.
 * @returns Object with needed import statements and declaration texts.
 */
export function resolveNeededBindings(
  freeVars: Set<string>,
  sourceBindings: Map<string, SourceBinding>,
): { imports: string[]; declarations: string[]; unresolved: string[] } {
  const neededImports = new Set<string>();
  const neededDeclarations = new Set<string>();
  const unresolved: string[] = [];
  const resolved = new Set<string>();

  const resolveVars = (vars: Set<string>): void => {
    for (const varName of vars) {
      if (resolved.has(varName)) continue;
      resolved.add(varName);

      const binding = sourceBindings.get(varName);
      if (!binding) {
        unresolved.push(varName);
        continue;
      }

      if (binding.kind === "import") {
        neededImports.add(binding.sourceText);
      } else {
        // Parse the declaration with oxc-parser (handles TypeScript) and collect
        // all Identifier names, then resolve those that match other source bindings.
        const identifiers = collectIdentifierNames(binding.sourceText);
        const referencedVars = new Set<string>();
        for (const id of identifiers) {
          if (id !== varName && sourceBindings.has(id)) {
            referencedVars.add(id);
          }
        }
        resolveVars(referencedVars);
        neededDeclarations.add(binding.sourceText);
      }
    }
  };

  resolveVars(freeVars);

  return {
    imports: [...neededImports],
    declarations: [...neededDeclarations],
    unresolved,
  };
}

function buildPrecompiledExpr(bundleCode: string, argsObject: string): string {
  return (
    "(() => {\n" +
    "  const module = { exports: {} };\n" +
    "  const exports = module.exports;\n" +
    `${bundleCode}\n` +
    `  return module.exports.main(${argsObject});\n` +
    "})()"
  );
}

/**
 * Build entry file content from already-resolved imports and declarations.
 * @param imports - Import statement texts.
 * @param declarations - Declaration statement texts.
 * @param fnSource - The function source code.
 * @param sourceFilePath - Path to the source file for resolving relative imports.
 * @param multiArg - Whether the function accepts multiple arguments (spread via `...args`).
 * @returns Entry file content string.
 */
export function buildMinimalEntryFromResolved(
  imports: string[],
  declarations: string[],
  fnSource: string,
  sourceFilePath: string,
  multiArg = false,
): string {
  const sourceDir = resolve(sourceFilePath, "..").replace(/\\/g, "/");

  // Rewrite relative import paths to absolute paths so rolldown can resolve them
  const resolvedImports = imports.map((imp) =>
    imp.replace(
      /from\s+["'](\.[^"']+)["']/g,
      (_match, relPath: string) => `from "${resolve(sourceDir, relPath).replace(/\\/g, "/")}"`,
    ),
  );

  const lines = [
    ...resolvedImports,
    ...declarations,
    multiArg
      ? `export function main(...args) { return (${fnSource})(...args); }`
      : `export function main(input) { return (${fnSource})(input); }`,
  ];
  return lines.join("\n");
}

async function bundleScriptTarget(args: {
  fn: ScriptFunction;
  kind: "hooks" | "validate" | "typeHook" | "typeValidate";
  sourceFilePath: string;
  sourceBindings: Map<string, SourceBinding>;
  tempDir: string;
  targetIndex: number;
  tsconfig: string | undefined;
}): Promise<string> {
  const { fn, kind, sourceFilePath, sourceBindings, tempDir, targetIndex, tsconfig } = args;
  const context = `${kind} in ${sourceFilePath}`;
  const fnSource = stringifyFunction(fn);
  const argsObject =
    kind === "hooks"
      ? `{ value: _value, oldValue: _oldValue, invoker: ${tailorPrincipalMap}, now: _now }`
      : kind === "validate"
        ? `{ value: _value }`
        : kind === "typeHook"
          ? `{ input: _input, oldRecord: _oldRecord, invoker: ${tailorPrincipalMap}, now: _now }`
          : `{ newRecord: _newRecord, oldRecord: _oldRecord, invoker: ${tailorPrincipalMap} }, __issues`;
  const inlineExpr = assertParsableExpression(`(${fnSource})(${argsObject})`, context);

  // Check if the function has free variables that need bundling
  const freeVars = findUndefinedReferences(`const __fn = ${fnSource};`);
  if (freeVars.size === 0) {
    // No external dependencies - use inline expression without bundling
    return inlineExpr;
  }

  const { imports, declarations, unresolved } = resolveNeededBindings(freeVars, sourceBindings);
  if (unresolved.length > 0) {
    throw new Error(
      `${context} captures unresolvable variables (${unresolved.join(", ")}). ` +
        "Hooks and validators must not reference variables that cannot be resolved from the source file.\n" +
        `  ${kind}: ${fnSource}`,
    );
  }

  const entryContent = buildMinimalEntryFromResolved(
    imports,
    declarations,
    fnSource,
    sourceFilePath,
    kind === "typeValidate",
  );
  const entryPath = join(tempDir, `tailordb-script-${targetIndex}.entry.ts`);

  writeFileSync(entryPath, entryContent);

  const buildResult = await rolldown.build({
    plugins: [platformBundleDefinePlugin],
    input: entryPath,
    write: false,
    output: {
      format: "cjs",
      sourcemap: false,
      minify: true,
      codeSplitting: false,
    },
    tsconfig,
    treeshake: {
      moduleSideEffects: false,
      annotations: true,
      unknownGlobalSideEffects: false,
    },
    logLevel: "silent",
  } as rolldown.BuildOptions);

  const bundledCode = buildResult.output[0].code;
  return assertParsableExpression(buildPrecompiledExpr(bundledCode, argsObject), context);
}

/**
 * Precompile TailorDB hooks/validators into self-contained script expressions using rolldown.
 * Uses oxc-parser AST walking to extract free variables from functions, then builds
 * minimal entry points containing only the needed imports and declarations.
 * @param type - TailorDB type schema output.
 * @param sourceFilePath - Source file where the type is defined.
 * @param tsconfig - Resolved tsconfig path, or undefined if not found.
 */
export async function precompileTailorDBTypeScripts(
  type: TailorDBTypeSchemaOutput,
  sourceFilePath: string,
  tsconfig: string | undefined,
): Promise<void> {
  const targets = collectScriptTargets(type);
  if (targets.length === 0) return;

  // Collect source bindings once for all targets in this file
  const sourceBindings = collectSourceBindings(sourceFilePath);

  // Use type name in temp dir to avoid race conditions when multiple type files
  // are precompiled concurrently via Promise.all in service.ts
  const tempDir = resolve(getDistDir(), "hooks-validate-scripts", type.name);
  mkdirSync(tempDir, { recursive: true });

  try {
    const results = await Promise.allSettled(
      targets.map((target, index) =>
        bundleScriptTarget({
          fn: target.fn,
          kind: target.kind,
          sourceFilePath,
          sourceBindings,
          tempDir,
          targetIndex: index,
          tsconfig,
        }),
      ),
    );
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (firstError) {
      throw firstError.reason;
    }
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        setPrecompiledScriptExpr(
          assertDefined(targets[index], `bundle target at index ${index} missing`).fn,
          result.value,
        );
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
