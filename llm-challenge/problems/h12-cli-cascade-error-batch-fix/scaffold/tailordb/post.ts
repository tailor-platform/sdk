import { db } from "@tailor-platform/sdk";

// BUG: same `db.text(...)` typo as article.ts / note.ts. Fix all three at once.
export const post = db.type("Post", {
  subject: db.text(),
  content: db.text(),
  excerpt: db.text(),
});
