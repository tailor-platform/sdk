import { Linter } from "eslint";
import * as globals from "globals";
import type { ParsedField } from "./types";

interface ScriptContext {
  typeName: string;
  fieldName: string;
  kind: "validate" | "hook.create" | "hook.update";
}

// ESLint Linter instance (reused for performance)
const linter = new Linter();

// TailorDB script runtime variables (injected at runtime)
const tailordbRuntimeGlobals: Linter.Globals = {
  _value: "readonly",
  _data: "readonly",
  _user: "readonly",
  // Tailor runtime provides `user` when evaluating scripts via tailorUserMap
  user: "readonly",
};

// ESLint configuration for detecting undefined variables
const eslintConfig: Linter.Config = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    globals: {
      // ES built-in globals (Math, JSON, Array, Object, etc.)
      ...globals.builtin,
      // Additional globals available in TailorDB runtime
      console: "readonly",
      ...tailordbRuntimeGlobals,
    },
  },
  rules: {
    "no-undef": "error",
  },
};

/**
 * Ensure that a TailorDB script expression does not reference external variables.
 * @param {string} expr - JavaScript expression to validate
 * @param {ScriptContext} ctx - Script context (type, field, kind)
 * @returns {void}
 */
export function ensureNoExternalVariablesInScript(expr: string, ctx: ScriptContext): void {
  if (!expr.trim()) return;

  let messages: Linter.LintMessage[];
  try {
    messages = linter.verify(expr, eslintConfig, {
      filename: "tailordb-script.js",
    });
  } catch (error) {
    throw new Error(
      `Failed to parse TailorDB ${ctx.kind} script for ${ctx.typeName}.${ctx.fieldName}: ${String(error)}`,
    );
  }

  if (messages.length === 0) return;

  const externalNames = new Set<string>();
  for (const err of messages) {
    const match = err.message.match(/'([^']+)' is not defined/);
    if (match) {
      externalNames.add(match[1]);
    }
  }

  if (externalNames.size === 0) return;

  const namesList = [...externalNames].sort().join(", ");
  throw new Error(
    `TailorDB ${ctx.kind} for ${ctx.typeName}.${ctx.fieldName} captures external variables (${namesList}). ` +
      "Hooks and validators must not reference variables outside their own parameters and local declarations.",
  );
}

type TailorDBFieldConfig = ParsedField["config"];

/**
 * Ensure that TailorDB field scripts do not capture external variables.
 * @param {string} typeName - TailorDB type name
 * @param {string} fieldName - Field name
 * @param {TailorDBFieldConfig} fieldConfig - Parsed field configuration
 * @returns {void}
 */
export function ensureNoExternalVariablesInFieldScripts(
  typeName: string,
  fieldName: string,
  fieldConfig: TailorDBFieldConfig,
): void {
  for (const validateConfig of fieldConfig.validate ?? []) {
    const expr = validateConfig.script?.expr;
    if (expr) {
      ensureNoExternalVariablesInScript(expr, {
        typeName,
        fieldName,
        kind: "validate",
      });
    }
  }

  if (fieldConfig.hooks?.create?.expr) {
    ensureNoExternalVariablesInScript(fieldConfig.hooks.create.expr, {
      typeName,
      fieldName,
      kind: "hook.create",
    });
  }
  if (fieldConfig.hooks?.update?.expr) {
    ensureNoExternalVariablesInScript(fieldConfig.hooks.update.expr, {
      typeName,
      fieldName,
      kind: "hook.update",
    });
  }
}
