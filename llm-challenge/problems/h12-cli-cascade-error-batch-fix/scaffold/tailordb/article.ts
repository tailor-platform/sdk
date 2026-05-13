import { db } from "@tailor-platform/sdk";

// BUG: `db.text(...)` is not a TailorDB field builder. The same typo also
// appears in tailordb/note.ts and tailordb/post.ts — grep before editing so
// every occurrence is fixed in a single pass.
export const article = db.type("Article", {
  title: db.text(),
  summary: db.text(),
});
