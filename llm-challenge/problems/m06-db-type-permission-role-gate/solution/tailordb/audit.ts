import { db, type TailorTypePermission } from "@tailor-platform/sdk";

type AuditUser = { id: string; role: string };

const permission: TailorTypePermission<AuditUser> = {
  create: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
  read: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
  update: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
  delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
};

export const audit = db
  .type("Audit", {
    message: db.string(),
  })
  .permission<AuditUser>(permission);
