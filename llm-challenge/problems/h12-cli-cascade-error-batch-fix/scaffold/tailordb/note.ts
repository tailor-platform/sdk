import { db } from "@tailor-platform/sdk";

// BUG: same `db.text(...)` typo as article.ts / post.ts. Fix all three at once.
export const note = db.type("Note", {
  heading: db.text(),
  body: db.text(),
});
