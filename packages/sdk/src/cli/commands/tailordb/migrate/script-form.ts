/**
 * Static analysis of a migration script's exports: a single-transaction
 * `main`, or a `steps` object whose shape is read from the source so a broken
 * step graph is reported before deploy touches the schema.
 */

import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import { CLIError } from "#/cli/shared/errors";
import { orderMigrationSteps, type MigrationStepNode } from "#/utils/migration-steps";
import type {
  Expression,
  ModuleExportName,
  ObjectExpression,
  Program,
  PropertyKey,
} from "@oxc-project/types";

/** How a migration script is executed. */
export type MigrationScriptForm =
  | { kind: "main" }
  | { kind: "steps"; steps: MigrationStepNode[]; order: string[] };

const STEP_KEYS = new Set(["run", "dependsOn"]);

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

interface ExportedNames {
  hasMain: boolean;
  stepsInit: Expression | null | undefined;
  stepsViaSpecifier: boolean;
}

function collectExports(program: Program): ExportedNames {
  const result: ExportedNames = { hasMain: false, stepsInit: undefined, stepsViaSpecifier: false };
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (declaration?.type === "FunctionDeclaration" && declaration.id?.name === "main") {
      result.hasMain = true;
    }
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type !== "Identifier") continue;
        if (declarator.id.name === "main") result.hasMain = true;
        if (declarator.id.name === "steps") {
          result.stepsInit = declaration.kind === "const" ? declarator.init : null;
        }
      }
    }
    for (const specifier of statement.specifiers) {
      const exported = propertyName(specifier.exported);
      if (exported === "main") result.hasMain = true;
      if (exported === "steps") result.stepsViaSpecifier = true;
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
      throw invalidScript(filePath, `Step "${name}" must be an object with a \`run\` function.`);
    }

    let hasRun = false;
    let dependsOn: string[] = [];
    for (const field of value.properties) {
      const key =
        field.type === "SpreadElement" || field.computed ? undefined : propertyName(field.key);
      if (key === undefined || !STEP_KEYS.has(key)) {
        throw invalidScript(
          filePath,
          `Step "${name}" has unknown key ${key === undefined ? "(spread or computed)" : `"${key}"`}.`,
        );
      }
      if (field.type === "SpreadElement") continue;
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
  const exportsSteps = exports.stepsInit !== undefined || exports.stepsViaSpecifier;
  if (exports.hasMain && exportsSteps) {
    throw invalidScript(filePath, "it exports both `main` and `steps`; keep one.");
  }
  if (exports.hasMain) return { kind: "main" };
  if (!exportsSteps) {
    throw invalidScript(filePath, "it must export either `main` or `steps`.");
  }
  if (exports.stepsViaSpecifier) {
    throw invalidScript(filePath, "declare `steps` directly as `export const steps = { ... }`.");
  }
  const init = exports.stepsInit ? unwrapExpression(exports.stepsInit) : undefined;
  if (init?.type !== "ObjectExpression") {
    throw invalidScript(filePath, "`steps` must be an object literal declared with `const`.");
  }

  const steps = readSteps(filePath, init);
  try {
    return { kind: "steps", steps, order: orderMigrationSteps(steps) };
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
