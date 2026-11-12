import type { AstCallExpression } from "./ast.js";
import type { ImportTracker } from "./sdk-bindings.js";
import type { Rule } from "eslint";

interface CheckOption {
  check?: "definition-files" | "all-files";
}

export const checkOptionSchema = {
  type: "object" as const,
  properties: { check: { enum: ["definition-files", "all-files"] } },
  additionalProperties: false,
};

export function checksAllFiles(context: Rule.RuleContext): boolean {
  const [option]: readonly (CheckOption | undefined)[] = context.options;
  return option?.check === "all-files";
}

const PLATFORM_FUNCTION_FACTORIES: ReadonlySet<string> = new Set([
  "createExecutor",
  "createHttpAdapter",
  "createResolver",
  "createWorkflowJob",
]);

export function platformFunctionFactories(
  imports: ImportTracker,
  calls: readonly AstCallExpression[],
): Set<string> {
  const factories = new Set<string>();
  for (const call of calls) {
    const name = imports.callName(call);
    if (name !== null && PLATFORM_FUNCTION_FACTORIES.has(name)) factories.add(name);
  }
  return factories;
}

export function suggestsAlternatives(factories: ReadonlySet<string>): boolean {
  return !(factories.size === 1 && factories.has("createHttpAdapter"));
}
