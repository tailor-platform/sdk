import { parseSync } from "oxc-parser";

const MAX_GENERATED_CODE_LENGTH = 2_000;

function formatGeneratedCode(expr: string): string {
  if (expr.length <= MAX_GENERATED_CODE_LENGTH) {
    return `Generated code:\n${expr}`;
  }
  return (
    `Generated code (truncated to ${MAX_GENERATED_CODE_LENGTH} of ${expr.length} characters):\n` +
    `${expr.slice(0, MAX_GENERATED_CODE_LENGTH)}\n...`
  );
}

/**
 * Assert that a generated script expression is syntactically valid JavaScript.
 * Invalid generated code would otherwise surface much later as a confusing
 * bundler or platform-side syntax error, far from the definition that caused it.
 * @param expr - Generated JavaScript expression
 * @param context - What generated the expression, used to label the error
 * @returns The expression unchanged when it parses successfully
 */
export function assertParsableExpression(expr: string, context: string): string {
  const { errors } = parseSync("generated-expr.js", `(${expr}\n);`);
  if (errors.length === 0) {
    return expr;
  }
  const details = errors.map((error) => `  - ${error.message}`).join("\n");
  throw new Error(
    `Generated ${context} script is not valid JavaScript.\n` +
      `Parse errors:\n${details}\n` +
      formatGeneratedCode(expr),
  );
}
