import { parseSync } from "oxc-parser";

/**
 * Assert that a generated script expression is syntactically valid JavaScript.
 * Invalid generated code would otherwise surface much later as a confusing
 * bundler or platform-side syntax error, far from the definition that caused it.
 * @param expr - Generated JavaScript expression
 * @param context - What generated the expression, used to label the error
 * @returns The expression unchanged when it parses successfully
 */
export function assertParsableExpression(expr: string, context: string): string {
  const { errors } = parseSync("generated-expr.js", `void (${expr}\n);`);
  if (errors.length === 0) {
    return expr;
  }
  const details = errors.map((error) => `  - ${error.message}`).join("\n");
  throw new Error(
    `Generated ${context} script is not valid JavaScript.\n` +
      `Parse errors:\n${details}\n` +
      `Generated code:\n${expr}`,
  );
}
