import { db } from "@tailor-platform/sdk";

export const post = db.type("Post", {
  subject: db.string(),
  content: db.string(),
  excerpt: db.string(),
});
