import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string().unique(),
  ...db.fields.timestamps(),
});

export type user = typeof user;
