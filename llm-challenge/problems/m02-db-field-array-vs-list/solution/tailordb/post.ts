import { db } from "@tailor-platform/sdk";

export const post = db.type("Post", {
  tags: db.string({ array: true, optional: true }),
});
