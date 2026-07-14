/**
 * Field interface for local input validation (subset of TailorField).
 * Matches the shape already attached to fields built by the configure
 * module's `t.*` builders, without importing configure's runtime code
 * (the cli module may not import configure at runtime; see AGENTS.md).
 */
interface ParsableField {
  _parseInternal(args: {
    value: unknown;
    data: unknown;
    user: Record<string, unknown>;
    pathArray: string[];
  }): { issues?: readonly { message: string; path?: readonly (string | number | symbol)[] }[] };
}

export interface LocalInputParseArgs {
  value: unknown;
  data: unknown;
  user: Record<string, unknown>;
}

export interface LocalInputParseResult {
  issues?: readonly { message: string; path?: readonly (string | number | symbol)[] }[];
}

/**
 * Build a local, in-process validator for a resolver's declared input fields.
 * Each field already carries its own bound `_parseInternal` (attached when the
 * user's resolver module was loaded via dynamic import), so this only needs to
 * orchestrate calling every field and collecting issues.
 * @param fields - Resolver's raw input field definitions (already-built TailorField instances)
 * @returns An object exposing a `.parse()` method for local format detection
 */
export function buildLocalInputParser(fields: Record<string, ParsableField>): {
  parse(args: LocalInputParseArgs): LocalInputParseResult;
} {
  return {
    parse({ value, data, user }) {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        value instanceof Date
      ) {
        return { issues: [{ message: `Expected an object: received ${String(value)}` }] };
      }
      const record = value as Record<string, unknown>;
      const issues: NonNullable<LocalInputParseResult["issues"]>[number][] = [];
      for (const [name, field] of Object.entries(fields)) {
        const result = field._parseInternal({
          value: record[name],
          data,
          user,
          pathArray: [name],
        });
        if (result.issues) {
          issues.push(...result.issues);
        }
      }
      return issues.length > 0 ? { issues } : {};
    },
  };
}
