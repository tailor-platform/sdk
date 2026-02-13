import { db } from "@tailor-platform/sdk";

export const post = db.type("Post", {
  title: db.string(),
  content: db.string({ optional: true }),
  published: db.bool(),
  category: db.enum(["tech", "lifestyle", "news", "other"]),
  ...db.fields.timestamps(),
});

export type post = typeof post;
