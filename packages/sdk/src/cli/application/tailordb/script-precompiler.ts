import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Linter } from "eslint";
import { parseSync } from "oxc-parser";
import { join, resolve } from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "@/cli/utils/dist-dir";
import { logger } from "@/cli/utils/logger";
import { stringifyFunction, tailorUserMap } from "@/parser/service/tailordb/field";
import { setPrecompiledScriptExpr } from "@/parser/service/tailordb/script-precompiled-expr";
import type { TailorDBTypeSchemaOutput } from "@/parser/service/tailordb/types";
import type {
  ImportDeclaration,
  VariableDeclaration,
  ExportNamedDeclaration,
} from "@oxc-project/types";

type ScriptFunction = (...args: unknown[]) => unknown;

type ScriptTarget = {
  fn: ScriptFunction;
};

/** Binding found in the source file: either an import or a top-level declaration */
export type SourceBinding = {
  name: string;
  /** The original source text of the import/declaration statement */
  sourceText: string;
  kind: "import" | "declaration";
};

const linter = new Linter();

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
      targets.push({ fn: createHook });
    }
    const updateHook = toScriptFunction(metadata.hooks?.update);
    if (updateHook) {
      targets.push({ fn: updateHook });
    }

    for (const validateInput of metadata.validate ?? []) {
      if (typeof validateInput === "function") {
        const validateFn = toScriptFunction(validateInput);
        if (validateFn) targets.push({ fn: validateFn });
      } else {
        const validateFn = toScriptFunction(validateInput[0]);
        if (validateFn) targets.push({ fn: validateFn });
      }
    }

    if (field.type === "nested" && field.fields) {
      for (const nestedField of Object.values(field.fields)) {
        collectFieldTargets(nestedField);
      }
    }
  };

  for (const field of Object.values(type.fields)) {
    collectFieldTargets(field);
  }

  return targets;
}

const linterConfig = {
  languageOptions: {
    ecmaVersion: "latest" as const,
    sourceType: "module" as const,
  },
  rules: { "no-undef": "error" as const },
};

/**
 * Run ESLint's no-undef rule on a code string and return the set of undefined identifiers.
 * @param code - Valid JavaScript code to analyze.
 * @returns Set of undefined variable names.
 */
function findUndefinedReferences(code: string): Set<string> {
  const messages = linter.verify(code, linterConfig);
  const vars = new Set<string>();
  for (const msg of messages) {
    if (msg.ruleId !== "no-undef") continue;
    const match = msg.message.match(/^'(.+)' is not defined/);
    if (match) {
      vars.add(match[1]);
    }
  }
  return vars;
}

/**
 * Extract free variables from a JavaScript function source using ESLint's no-undef rule.
 * @param fnSource - The function source code (from fn.toString()).
 * @returns Set of free variable names.
 */
export function extractFreeVariables(fnSource: string): Set<string> {
  return findUndefinedReferences(`const __fn = ${fnSource};`);
}

/**
 * Extract free variables from a declaration or arbitrary code statement.
 * @param code - A JavaScript statement (e.g. "const x = foo + bar;").
 * @returns Set of free variable names.
 */
function extractFreeVariablesFromStatement(code: string): Set<string> {
  return findUndefinedReferences(code);
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
      const importDecl = stmt as unknown as ImportDeclaration;
      const text = source.slice(importDecl.start, importDecl.end);
      if (importDecl.specifiers) {
        for (const spec of importDecl.specifiers) {
          bindings.set(spec.local.name, {
            name: spec.local.name,
            sourceText: text,
            kind: "import",
          });
        }
      }
    } else if (stmt.type === "VariableDeclaration") {
      const varDecl = stmt as unknown as VariableDeclaration;
      const text = source.slice(varDecl.start, varDecl.end);
      for (const decl of varDecl.declarations) {
        if (decl.id.type === "Identifier") {
          bindings.set(decl.id.name, { name: decl.id.name, sourceText: text, kind: "declaration" });
        }
      }
    } else if (stmt.type === "FunctionDeclaration") {
      const funcDecl = stmt as unknown as { id?: { name: string }; start: number; end: number };
      if (funcDecl.id) {
        const text = source.slice(funcDecl.start, funcDecl.end);
        bindings.set(funcDecl.id.name, {
          name: funcDecl.id.name,
          sourceText: text,
          kind: "declaration",
        });
      }
    } else if (stmt.type === "ExportNamedDeclaration") {
      const exportDecl = stmt as unknown as ExportNamedDeclaration;
      const innerDecl = exportDecl.declaration;
      if (!innerDecl) continue;

      if (innerDecl.type === "VariableDeclaration") {
        const varDecl = innerDecl as unknown as VariableDeclaration;
        // Use the full export statement text so the declaration is valid standalone
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
        const funcDecl = innerDecl as unknown as {
          id?: { name: string };
          start: number;
          end: number;
        };
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
  const neededDeclarations: string[] = [];
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
        neededDeclarations.push(binding.sourceText);
        // Recursively resolve dependencies of this declaration
        const declFreeVars = extractFreeVariablesFromStatement(binding.sourceText);
        resolveVars(declFreeVars);
      }
    }
  };

  resolveVars(freeVars);

  return {
    imports: [...neededImports],
    declarations: neededDeclarations,
    unresolved,
  };
}

function buildPrecompiledExpr(bundleCode: string): string {
  return (
    "(() => {\n" +
    "  const module = { exports: {} };\n" +
    "  const exports = module.exports;\n" +
    `${bundleCode}\n` +
    `  return module.exports.main({ value: _value, data: _data, user: ${tailorUserMap} });\n` +
    "})()"
  );
}

/**
 * Build entry file content from already-resolved imports and declarations.
 * @param imports - Import statement texts.
 * @param declarations - Declaration statement texts.
 * @param fnSource - The function source code.
 * @param sourceFilePath - Path to the source file for resolving relative imports.
 * @returns Entry file content string.
 */
export function buildMinimalEntryFromResolved(
  imports: string[],
  declarations: string[],
  fnSource: string,
  sourceFilePath: string,
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
    `export function main(input) { return (${fnSource})(input); }`,
  ];
  return lines.join("\n");
}

async function bundleScriptTarget(args: {
  fn: ScriptFunction;
  sourceFilePath: string;
  sourceBindings: Map<string, SourceBinding>;
  tempDir: string;
  targetIndex: number;
  tsconfig: string | undefined;
}): Promise<string> {
  const { fn, sourceFilePath, sourceBindings, tempDir, targetIndex, tsconfig } = args;
  const fnSource = stringifyFunction(fn);
  const inlineExpr = `(${fnSource})({ value: _value, data: _data, user: ${tailorUserMap} })`;

  // Check if the function has free variables that need bundling
  const freeVars = extractFreeVariables(fnSource);
  if (freeVars.size === 0) {
    // No external dependencies - use inline expression without bundling
    return inlineExpr;
  }

  const { imports, declarations, unresolved } = resolveNeededBindings(freeVars, sourceBindings);
  if (unresolved.length > 0) {
    // Some free variables could not be resolved from the source file
    // (e.g. function imported from another file with its own closure variables).
    // Fall back to the simple toString expression which is the pre-precompiler behaviour.
    logger.warn(
      `Could not resolve bindings for [${unresolved.join(", ")}] in ${sourceFilePath}. ` +
        "Falling back to inline expression.",
    );
    return inlineExpr;
  }

  const entryContent = buildMinimalEntryFromResolved(
    imports,
    declarations,
    fnSource,
    sourceFilePath,
  );
  const entryPath = join(tempDir, `tailordb-script-${targetIndex}.entry.ts`);
  const outputPath = join(tempDir, `tailordb-script-${targetIndex}.bundle.cjs`);

  writeFileSync(entryPath, entryContent);

  await rolldown.build(
    rolldown.defineConfig({
      input: entryPath,
      output: {
        file: outputPath,
        format: "cjs",
        sourcemap: false,
        minify: true,
        inlineDynamicImports: true,
      },
      tsconfig,
      treeshake: {
        moduleSideEffects: false,
        annotations: true,
        unknownGlobalSideEffects: false,
      },
      logLevel: "silent",
    }) as rolldown.BuildOptions,
  );

  const bundledCode = readFileSync(outputPath, "utf-8");
  return buildPrecompiledExpr(bundledCode);
}

/**
 * Precompile TailorDB hooks/validators into self-contained script expressions using rolldown.
 * Uses ESLint's no-undef rule to extract free variables from functions, then builds
 * minimal entry points containing only the needed imports and declarations.
 * @param type - TailorDB type schema output.
 * @param sourceFilePath - Source file where the type is defined.
 */
export async function precompileTailorDBTypeScripts(
  type: TailorDBTypeSchemaOutput,
  sourceFilePath: string,
): Promise<void> {
  const targets = collectScriptTargets(type);
  if (targets.length === 0) return;

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Collect source bindings once for all targets in this file
  const sourceBindings = collectSourceBindings(sourceFilePath);

  // Use type name in temp dir to avoid race conditions when multiple type files
  // are precompiled concurrently via Promise.all in service.ts
  const tempDir = resolve(getDistDir(), "tailordb-scripts", type.name);
  mkdirSync(tempDir, { recursive: true });

  try {
    for (const [index, target] of targets.entries()) {
      const expr = await bundleScriptTarget({
        fn: target.fn,
        sourceFilePath,
        sourceBindings,
        tempDir,
        targetIndex: index,
        tsconfig,
      });
      setPrecompiledScriptExpr(target.fn, expr);
    }
  } finally {
    // TODO: restore cleanup after debugging
    rmSync(tempDir, { recursive: true, force: true });
  }
}
