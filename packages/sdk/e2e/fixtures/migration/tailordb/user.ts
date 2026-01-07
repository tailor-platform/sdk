import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.string({ optional: true }),
});

export type user = typeof user;
