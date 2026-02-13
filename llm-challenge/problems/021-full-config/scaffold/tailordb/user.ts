import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  email: db.string().unique(),
  name: db.string(),
  role: db.enum(["admin", "member", "viewer"]),
  ...db.fields.timestamps(),
});

export type user = typeof user;
