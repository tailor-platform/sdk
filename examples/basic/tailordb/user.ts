import { db } from "@tailor-platform/tailor-sdk";
import { role } from "./role";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string().unique(),
    status: db.string().optional(),
    department: db.string().optional(),
    roleId: db.uuid().relation({
      type: "1-n",
      toward: { type: role },
    }),
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
