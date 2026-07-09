import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";

export const adminNote = db
  .table("AdminNote", {
    title: db.string(),
    content: db.string(),
    authorId: db.uuid().hooks({ create: ({ invoker }) => invoker?.id ?? crypto.randomUUID() }),
    ...db.fields.timestamps(),
  })
  // NOTE: This permits all operations for simplicity.
  // In production, configure proper permissions based on your requirements.
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
