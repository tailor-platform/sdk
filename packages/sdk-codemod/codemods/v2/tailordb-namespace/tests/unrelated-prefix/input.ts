// Identifiers that merely *start* with `Tailordb` (or have an unknown
// member) must not be rewritten by the codemod.

namespace MyTailordb {
  export type QueryResult<T> = { rows: T[] };
}

type Mine = MyTailordb.QueryResult<{ id: string }>;

// Unknown member on the deprecated namespace stays untouched (best-effort
// safety net — there is no `Tailordb.NotAType` on the SDK side).
type Untouched = Tailordb.NotAType;

// A suffix-extended member name must also stay intact.
type Extra = Tailordb.QueryResultExtra;
