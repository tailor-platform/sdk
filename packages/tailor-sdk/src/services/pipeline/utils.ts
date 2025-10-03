/**
 * Determines whether an object is a Resolver instance
 * Uses property-based checking to avoid instanceof issues in ES module environments
 *
 * @param obj The object to check
 * @returns true if the object is a Resolver, false otherwise
 */
export function isResolver(value: unknown): boolean {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.queryType === "string" &&
    typeof obj.name === "string" &&
    typeof obj.input === "object" &&
    typeof obj.fnStep === "function" &&
    typeof obj.sqlStep === "function" &&
    typeof obj.gqlStep === "function" &&
    typeof obj.returns === "function"
  );
}
