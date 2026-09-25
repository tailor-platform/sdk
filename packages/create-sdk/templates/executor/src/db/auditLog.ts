import { db } from "@tailor-platform/sdk";

export const auditLog = db
  .table("AuditLog", "Records system events for auditing", {
    action: db.string(),
    entityType: db.string(),
    entityId: db.uuid(),
    message: db.string(),
    ...db.fields.timestamps(),
  })
  .indexes({ fields: ["entityType", "entityId"], unique: false })
  .permission({
    create: [[{ user: "_loggedIn" }, "=", true]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ user: "_loggedIn" }, "=", true]],
    delete: [[{ user: "_loggedIn" }, "=", true]],
  })
  .gqlPermission([
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: "all",
      permit: true,
    },
  ]);
