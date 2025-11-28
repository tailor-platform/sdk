import { db } from "@tailor-platform/sdk";

export const user = db
  .type("User", {
    name: db.string().unique(),
    role: db.enum("USER", "ADMIN"),
    ...db.fields.timestamps(),
  })
  .permission({
    create: [{ conditions: [], permit: true }],
    read: [{ conditions: [], permit: true }],
    update: [{ conditions: [], permit: true }],
    delete: [{ conditions: [], permit: true }],
  })
  .gqlPermission([{ conditions: [], actions: "all", permit: true }]);
