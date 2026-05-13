import { db } from "@tailor-platform/sdk";

export const author = db.type("Author", {
  name: db.string(),
});
