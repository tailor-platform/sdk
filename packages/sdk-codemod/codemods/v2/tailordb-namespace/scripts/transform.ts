// Members of the removed capital-cased `Tailordb` ambient namespace
// (originally from `@tailor-platform/function-types`). Each is a type-only
// declaration now available under the lowercase `tailordb` namespace exposed
// by `@tailor-platform/sdk/runtime/globals`. Anything outside this list is
// left untouched so user-defined symbols that happen to share the
// `Tailordb.` prefix are not rewritten by accident.
const TAILORDB_MEMBERS = ["QueryResult", "CommandType", "Client"] as const;

const MEMBER_GROUP = TAILORDB_MEMBERS.join("|");

// Match `Tailordb.<Member>` with word boundaries so neither prefix nor
// suffix collisions (e.g. `MyTailordb.X`, `Tailordb.QueryResultExtra`) are
// rewritten. Generic-argument lists and `typeof` qualifiers are not part of
// the match — they fall outside the boundary and are preserved verbatim.
const PATTERN = new RegExp(String.raw`\bTailordb\.(${MEMBER_GROUP})\b`, "g");

/**
 * Rewrite references to the capital-cased `Tailordb` ambient namespace to the
 * lowercase `tailordb` namespace. The capital-cased namespace was inherited
 * from `@tailor-platform/function-types`; the SDK kept it as a `@deprecated`
 * alias in v1 and removed it in v2, leaving only the lowercase `tailordb.*`
 * namespace exposed by `@tailor-platform/sdk/runtime/globals`.
 *
 * Only the known type-only members (`QueryResult`, `CommandType`, `Client`)
 * are rewritten so that unrelated user-defined symbols sharing the
 * `Tailordb.` prefix remain untouched. Both type-position references
 * (`Tailordb.QueryResult<T>`, `typeof Tailordb.Client`) and value-position
 * references (`new Tailordb.Client(...)`) are handled by the same rule.
 * @param source - File contents
 * @param _filePath - Absolute path to the file (kept for the runner signature)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, _filePath: string): string | null {
  if (!source.includes("Tailordb.")) return null;
  PATTERN.lastIndex = 0;
  const updated = source.replace(PATTERN, (_match, member: string) => `tailordb.${member}`);
  return updated === source ? null : updated;
}
