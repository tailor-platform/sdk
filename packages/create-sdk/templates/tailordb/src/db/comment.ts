import { db } from "@tailor-platform/sdk";
import { allPermission, allGqlPermission } from "./permission";
import { task } from "./task";
import { user } from "./user";

export const comment = db
  .table("Comment", "A comment on a task", {
    body: db.string().validate([({ value }) => value.length >= 1, "Comment must not be empty"]),
    taskId: db.uuid().relation({
      type: "n-1",
      toward: { type: task },
    }),
    authorId: db.uuid().relation({
      type: "n-1",
      toward: { type: user },
    }),
    metadata: db.object({
      source: db.string().description("Where the comment was posted from"),
      editedAt: db.datetime({ optional: true }),
      isInternal: db.bool().description("Whether comment is internal only"),
    }),
    ...db.fields.timestamps(),
  })
  .indexes({ fields: ["taskId", "createdAt"], unique: false })
  .permission(allPermission)
  .gqlPermission(allGqlPermission);
