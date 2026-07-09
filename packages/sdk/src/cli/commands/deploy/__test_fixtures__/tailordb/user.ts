import { db } from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.enum(["ADMIN", "MEMBER"]),
  ...db.fields.timestamps(),
});
