/**
 * Static analysis of a migration script's exports: a single-transaction
 * `main`, or a `steps` object whose shape is read from the source so a broken
 * step graph is reported before deploy touches the schema.
 */

import * as fs from "node:fs";
import { parseSync, Visitor } from "oxc-parser";
import { CLIError } from "#/cli/shared/errors";
import { orderMigrationSteps, type MigrationStepNode } from "#/utils/migration-steps";
import type {
  BindingPattern,
  BindingRestElement,
  Expression,
  ModuleExportName,
  ObjectExpression,
  Program,
  PropertyKey,
} from "@oxc-project/types";

/** How a migration script is executed. */
export type MigrationScriptForm =
  | {
      kind: "main";
      /** The script also exports `steps`, which `main` takes precedence over. */
      ignoredSteps?: true;
    }
  | { kind: "steps"; order: string[] };

const STEP_KEYS = new Set(["run", "dependsOn"]);

/**
 * Whether a migration runs each step as its own job. A script with a single
 * step runs like `main`, because there is nothing to resume between steps,
 * unless an earlier deploy left it in progress and its record must be honored.
 * @param form - How the migration script runs, or null without a script
 * @param resumed - Whether an earlier deploy left this migration in progress
 * @returns True when the migration runs through the step runner
 */
export function usesStepRunner(form: MigrationScriptForm | null, resumed: boolean): boolean {
  return form?.kind === "steps" && (form.order.length > 1 || resumed);
}

function invalidScript(filePath: string, problem: string): Error {
  return CLIError({
    code: "MIGRATION_SCRIPT_INVALID",
    message: `Invalid migration script ${filePath}: ${problem}`,
  });
}

function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "ParenthesizedExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(key: PropertyKey | ModuleExportName): string | undefined {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

function boundNames(pattern: BindingPattern | BindingRestElement): string[] {
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "AssignmentPattern":
      return boundNames(pattern.left);
    case "RestElement":
      return boundNames(pattern.argument);
    case "ObjectPattern":
      return pattern.properties.flatMap((property) =>
        boundNames(property.type === "RestElement" ? property : property.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap((element) => (element ? boundNames(element) : []));
  }
}

interface ExportedNames {
  hasMain: boolean;
  stepsInit: Expression | null | undefined;
  stepsExportedIndirectly: boolean;
  hasUnreadableExports: boolean;
}

function collectExports(program: Program): ExportedNames {
  const result: ExportedNames = {
    hasMain: false,
    stepsInit: undefined,
    stepsExportedIndirectly: false,
    hasUnreadableExports: false,
  };
  for (const statement of program.body) {
    if (statement.type === "ExportAllDeclaration") {
      if (statement.exportKind === "type") continue;
      if (!statement.exported) result.hasUnreadableExports = true;
      else if (propertyName(statement.exported) === "main") result.hasMain = true;
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") continue;
    const declaration = statement.declaration;
    if (declaration?.type === "FunctionDeclaration" && declaration.id?.name === "main") {
      result.hasMain = true;
    }
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type !== "Identifier") {
          const names = boundNames(declarator.id);
          if (names.includes("main")) result.hasMain = true;
          if (names.includes("steps")) result.stepsExportedIndirectly = true;
          continue;
        }
        if (declarator.id.name === "main") result.hasMain = true;
        if (declarator.id.name === "steps") {
          result.stepsInit = declaration.kind === "const" ? declarator.init : null;
        }
      }
    }
    for (const specifier of statement.specifiers) {
      if (specifier.exportKind === "type") continue;
      const exported = propertyName(specifier.exported);
      if (exported === "main") result.hasMain = true;
      if (exported === "steps") result.stepsExportedIndirectly = true;
    }
  }
  return result;
}

function readSteps(filePath: string, object: ObjectExpression): MigrationStepNode[] {
  const steps: MigrationStepNode[] = [];
  for (const property of object.properties) {
    if (property.type === "SpreadElement") {
      throw invalidScript(filePath, "`steps` cannot use spread properties.");
    }
    const name = property.computed ? undefined : propertyName(property.key);
    if (name === undefined) {
      throw invalidScript(filePath, "step names must be written literally in `steps`.");
    }
    const value = unwrapExpression(property.value);
    if (property.method || property.kind !== "init" || value.type !== "ObjectExpression") {
      throw invalidScript(
        filePath,
        `Step "${name}" must be an object literal with a \`run\` function, written inside \`steps\`.`,
      );
    }

    let hasRun = false;
    let dependsOn: string[] = [];
    for (const field of value.properties) {
      const key =
        field.type === "SpreadElement" || field.computed ? undefined : propertyName(field.key);
      if (field.type === "SpreadElement" || key === undefined || !STEP_KEYS.has(key)) {
        throw invalidScript(
          filePath,
          `Step "${name}" has unknown key ${key === undefined ? "(spread or computed)" : `"${key}"`}.`,
        );
      }
      if (key === "run") {
        hasRun = true;
        continue;
      }
      const list = unwrapExpression(field.value);
      const elements = list.type === "ArrayExpression" ? list.elements : undefined;
      const literals = elements?.map((element) =>
        element?.type === "Literal" && typeof element.value === "string" ? element.value : null,
      );
      if (!literals || literals.some((literal) => literal === null)) {
        throw invalidScript(
          filePath,
          `Step "${name}" must list \`dependsOn\` as an array of string literals.`,
        );
      }
      dependsOn = literals as string[];
    }
    if (!hasRun) throw invalidScript(filePath, `Step "${name}" is missing \`run\`.`);
    steps.push({ name, dependsOn });
  }
  return steps;
}

/**
 * Determine how a migration script runs from its source.
 * @param source - Script source
 * @param filePath - Path used in error messages
 * @returns The script's execution form
 */
export function analyzeMigrationScriptSource(
  source: string,
  filePath: string,
): MigrationScriptForm {
  const { program, errors } = parseSync(filePath, source, { sourceType: "module", lang: "ts" });
  if (errors.length > 0) {
    throw CLIError({
      code: "MIGRATION_SCRIPT_INVALID",
      message: `Failed to parse ${filePath}: ${errors.map((error) => error.message).join("; ")}`,
    });
  }

  const exports = collectExports(program);
  const exportsSteps = exports.stepsInit !== undefined || exports.stepsExportedIndirectly;
  if (exports.hasMain || exports.hasUnreadableExports) {
    return exportsSteps ? { kind: "main", ignoredSteps: true } : { kind: "main" };
  }
  if (!exportsSteps) {
    throw invalidScript(filePath, "it must export either `main` or `steps`.");
  }
  if (exports.stepsExportedIndirectly) {
    throw invalidScript(filePath, "declare `steps` directly as `export const steps = { ... }`.");
  }
  const init = exports.stepsInit ? unwrapExpression(exports.stepsInit) : undefined;
  if (init?.type !== "ObjectExpression") {
    throw invalidScript(filePath, "`steps` must be an object literal declared with `const`.");
  }

  const steps = readSteps(filePath, init);
  try {
    return { kind: "steps", order: orderMigrationSteps(steps) };
  } catch (error) {
    throw invalidScript(filePath, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Determine how the migration script at a path runs.
 * @param filePath - Path to migrate.ts
 * @returns The script's execution form
 */
export function analyzeMigrationScript(filePath: string): MigrationScriptForm {
  return analyzeMigrationScriptSource(fs.readFileSync(filePath, "utf-8"), filePath);
}

// Earlier versions generated this comment, instead of a `TODO()` call, to mark what still needs a decision.
const LEGACY_REVIEW_MARKER = "TODO(tailor-migration-review)";

/** How to resolve what {@link countUnresolvedTodos} counts, for the error that reports it. */
export const UNRESOLVED_TODO_SUGGESTION =
  "Replace each TODO() call with the value or logic it asks for, then remove the TODO import from ./db. " +
  `For the ${LEGACY_REVIEW_MARKER} comment that earlier versions generated, review the code it marks, then remove the comment and the \`never\` annotation next to it.`;

/**
 * Count the placeholders a migration script still contains: the `TODO()` calls
 * its generator left for a decision, and the review marker that earlier
 * versions left in a comment.
 * @param source - Source of migrate.ts
 * @param filePath - Path used in the parse error
 * @returns Number of unresolved placeholders
 */
export function countUnresolvedTodos(source: string, filePath: string): number {
  const { program, errors } = parseSync(filePath, source, { sourceType: "module", lang: "ts" });
  if (errors.length > 0) {
    throw CLIError({
      code: "MIGRATION_SCRIPT_INVALID",
      message: `Failed to parse ${filePath}: ${errors.map((error) => error.message).join("; ")}`,
    });
  }
  let calls = 0;
  new Visitor({
    CallExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "TODO") calls++;
    },
  }).visit(program);
  return calls + source.split(LEGACY_REVIEW_MARKER).length - 1;
}

/**
 * Count the placeholders the migration script at a path still contains.
 * @param filePath - Path to migrate.ts
 * @returns Number of unresolved placeholders
 */
export function countUnresolvedTodosInFile(filePath: string): number {
  return countUnresolvedTodos(fs.readFileSync(filePath, "utf-8"), filePath);
}

/**
 * Warning for a script whose `steps` export is ignored in favor of `main`.
 * @param migrationLabel - Namespace and migration number, e.g. `main-db/0003`
 * @returns Warning message
 */
export function ignoredStepsWarning(migrationLabel: string): string {
  return `Migration ${migrationLabel}: migrate.ts exports \`steps\` next to \`main\` (or an \`export *\` that may provide it), so \`main\` runs and \`steps\` is ignored. Remove the export you do not use.`;
}
