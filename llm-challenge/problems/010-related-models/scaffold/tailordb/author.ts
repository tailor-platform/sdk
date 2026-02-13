import { db } from "@tailor-platform/sdk";

export const author = db.type("Author", {
  name: db.string(),
  email: db.string().unique(),
  bio: db.string({ optional: true }),
  ...db.fields.timestamps(),
});

export type author = typeof author;
