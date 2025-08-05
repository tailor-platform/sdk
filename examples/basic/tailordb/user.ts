import { db } from "@tailor-platform/tailor-sdk";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string().unique(),
    status: db.string().optional(),
    department: db.string().optional(),
    ...db.fields.timestamps(),
  })
  .indexes(
    { fields: ["name", "department"], unique: false },
    {
      fields: ["status", "createdAt"],
      unique: false,
      name: "user_status_created_idx",
    },
  );
export type user = typeof user;
