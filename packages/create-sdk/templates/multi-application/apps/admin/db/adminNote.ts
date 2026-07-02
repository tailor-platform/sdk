import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";

type UUIDString = `${string}-${string}-${string}-${string}-${string}`;

export const adminNote = db
  .type("AdminNote", {
    title: db.string(),
    content: db.string(),
    authorId: db.uuid().hooks({
      create: ({ invoker }) => (invoker?.id ?? crypto.randomUUID()) as UUIDString,
    }),
    ...db.fields.timestamps(),
  })
  // NOTE: This permits all operations for simplicity.
  // In production, configure proper permissions based on your requirements.
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
