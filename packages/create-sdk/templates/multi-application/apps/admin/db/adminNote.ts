import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";

export const adminNote = db
  .type("AdminNote", {
    title: db.string(),
    content: db.string(),
    authorId: db.uuid(),
    ...db.fields.timestamps(),
  })
  .hooks({
    create: ({ data, user }) => ({
      ...data,
      authorId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    update: ({ data }) => ({
      ...data,
      updatedAt: new Date(),
    }),
  })
  // NOTE: This permits all operations for simplicity.
  // In production, configure proper permissions based on your requirements.
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
