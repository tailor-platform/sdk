import { db } from "@tailor-platform/tailor-sdk";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string(),
    status: db.string().optional(),
    department: db.string().optional(),
    ...db.fields.timestamps(),
  })
  .indexes(
    { fields: ["name", "department"], unique: false },
    { fields: ["status", "createdAt"], unique: false },
  );
export type user = typeof user;
