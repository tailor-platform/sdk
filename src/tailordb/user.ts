import { db, t } from "@tailor-platform/tailor-sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string(),
  ...db.fields.timestamps(),
});
export type user = typeof user;
export type User = t.infer<user>;
