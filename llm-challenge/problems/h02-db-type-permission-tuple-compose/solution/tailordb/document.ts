import { db, type TailorTypePermission } from "@tailor-platform/sdk";

type DocumentUser = { id: string; role: string };

const permission: TailorTypePermission<
  DocumentUser,
  { id: string; title: string; ownerId: string }
> = {
  create: [{ conditions: [], permit: true }],
  read: [{ conditions: [], permit: true }],
  update: [
    {
      conditions: [
        [{ newRecord: "ownerId" }, "=", { user: "id" }],
        [{ user: "role" }, "=", "editor"],
      ],
      permit: true,
    },
  ],
  delete: [{ conditions: [], permit: true }],
};

export const document = db
  .type("Document", {
    title: db.string(),
    ownerId: db.string(),
  })
  .permission<DocumentUser>(permission);
