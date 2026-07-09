import { db } from "@tailor-platform/sdk";

export const post = db.table("Post", {
  title: db.string(),
  content: db.string({ optional: true }),
});

export type post = typeof post;
