import { db } from "@tailor-platform/sdk";

export const post = db.type("Post", {
  subject: db.text(),
  content: db.text(),
  excerpt: db.text(),
});
