import { db } from "@tailor-platform/sdk";

export const document = db
  .type("Document", {
    title: db.string(),
    content: db.string({ optional: true }),
    ownerId: db.uuid(),
    isPublic: db.bool(),
    ...db.fields.timestamps(),
  })
  .permission({
    create: [
      {
        conditions: [[{ user: "_loggedIn" }, "=", true]],
        permit: true,
      },
    ],
    read: [
      {
        conditions: [[{ record: "isPublic" }, "=", true]],
        permit: true,
      },
      {
        conditions: [[{ record: "ownerId" }, "=", { user: "id" }]],
        permit: true,
      },
    ],
    update: [
      {
        conditions: [[{ newRecord: "ownerId" }, "=", { user: "id" }]],
        permit: true,
      },
    ],
    delete: [
      {
        conditions: [[{ record: "ownerId" }, "=", { user: "id" }]],
        permit: true,
      },
    ],
  })
  .gqlPermission([
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: ["read", "create"],
      permit: true,
    },
    {
      conditions: [],
      actions: "all",
      permit: true,
    },
  ]);

export type document = typeof document;
