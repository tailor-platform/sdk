import { Linter } from "eslint";
import * as globals from "globals";
import { transformSync } from "oxc-transform";
import type { OperatorFieldConfig } from "./types";

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

export function ensureNoExternalVariablesInFieldScripts(
  typeName: string,
  fieldName: string,
  fieldConfig: OperatorFieldConfig,
): void {
  // Validate scripts
  for (const validateConfig of fieldConfig.validate ?? []) {
    const expr = validateConfig.script?.expr;
    if (expr) {
      checkScriptForExternalVariables(expr, {
        typeName,
        fieldName,
        kind: "validate",
      });
    }
  }

  // Hook scripts (create/update)
  if (fieldConfig.hooks?.create?.expr) {
    checkScriptForExternalVariables(fieldConfig.hooks.create.expr, {
      typeName,
      fieldName,
      kind: "hook.create",
    });
  }
  if (fieldConfig.hooks?.update?.expr) {
    checkScriptForExternalVariables(fieldConfig.hooks.update.expr, {
      typeName,
      fieldName,
      kind: "hook.update",
    });
  }
}

function checkScriptForExternalVariables(
  expr: string,
  ctx: ScriptContext,
): void {
  if (!expr.trim()) return;

  // Step 1: Transform TypeScript to JavaScript using oxc-transform
  let jsCode: string;
  try {
    const result = transformSync("tailordb-script.ts", expr, {
      typescript: {
        onlyRemoveTypeImports: false,
      },
    });

    if (result.errors && result.errors.length > 0) {
      const errorMessages = result.errors.map((e) => e.message).join(", ");
      throw new Error(
        `Failed to parse TailorDB ${ctx.kind} script for ${ctx.typeName}.${ctx.fieldName}: ${errorMessages}`,
      );
    }

    jsCode = result.code;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Failed to parse")) {
      throw error;
    }
    throw new Error(
      `Failed to parse TailorDB ${ctx.kind} script for ${ctx.typeName}.${ctx.fieldName}: ${String(error)}`,
    );
  }

  // Step 2: Use ESLint's no-undef rule to detect external variables
  const messages = linter.verify(jsCode, eslintConfig, {
    filename: "tailordb-script.js",
  });

  // Filter for no-undef errors only
  const undefErrors = messages.filter((m) => m.ruleId === "no-undef");

  if (undefErrors.length === 0) return;

  // Extract variable names from error messages
  const externalNames = new Set<string>();
  for (const err of undefErrors) {
    // ESLint no-undef message format: "'varName' is not defined."
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
