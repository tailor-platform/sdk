/** Plain object the TypeScript transform throws for source it cannot parse. */
export interface SyntaxDiagnostic {
  code: "InvalidSyntax";
  message: string;
  filename: string;
  startLine?: number;
}

/**
 * Check whether a thrown value is the TypeScript transform's parse diagnostic.
 * @param value - Value thrown while importing a module
 * @returns Whether `value` is a {@link SyntaxDiagnostic}
 */
export function isSyntaxDiagnostic(value: unknown): value is SyntaxDiagnostic {
  if (typeof value !== "object" || value === null || value instanceof Error) return false;
  const { code, message, filename, startLine } = value as Record<string, unknown>;
  return (
    code === "InvalidSyntax" &&
    typeof message === "string" &&
    typeof filename === "string" &&
    (startLine === undefined || typeof startLine === "number")
  );
}
