import { db } from "@tailor-platform/sdk";

// BUG: `db.text(...)` is not a TailorDB field builder. The two calls below
// fail typecheck. Swap *both* occurrences for the correct string builder in a
// single edit.
export const article = db.type("Article", {
  title: db.text(),
  summary: db.text(),
});
