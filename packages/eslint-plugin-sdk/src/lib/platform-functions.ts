import type { AstCallExpression } from "./ast.js";
import type { ImportTracker } from "./sdk-bindings.js";

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
