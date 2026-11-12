import { describeUnavailable } from "@tailor-platform/shared/node-builtins";
import type { AstCallExpression } from "./ast.js";
import type { ImportTracker } from "./sdk-bindings.js";
import type { Rule } from "eslint";

const CHECK_VALUES = ["definition-files", "all-files"] as const;

interface CheckOption {
  check?: (typeof CHECK_VALUES)[number];
}

export const checkOptionSchema = {
  type: "object" as const,
  properties: { check: { enum: [...CHECK_VALUES] } },
  additionalProperties: false,
};

const PLATFORM_FUNCTION_FACTORIES: ReadonlySet<string> = new Set([
  "createExecutor",
  "createHttpAdapter",
  "createResolver",
  "createWorkflowJob",
]);

type Describe = (name: string) => string;

function platformFunctionFactories(
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

export function unavailableDescriber(
  context: Rule.RuleContext,
  imports: ImportTracker,
  calls: readonly AstCallExpression[],
  describeWithSuggestion: Describe,
): Describe | null {
  const factories = platformFunctionFactories(imports, calls);
  const [option]: readonly (CheckOption | undefined)[] = context.options;
  if (factories.size === 0 && option?.check !== "all-files") return null;
  return [...factories].some((name) => name !== "createHttpAdapter")
    ? describeWithSuggestion
    : describeUnavailable;
}
