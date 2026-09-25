import { db } from "@tailor-platform/sdk";

export const CreatorProfile = db
  .table("CreatorProfile", {
    handle: db.string().unique(),
    displayName: db.string(),
    tags: db.string({ array: true }).unique(),
    avatarLabel: db.string(),
  })
  .files({
    avatarImage: "Uploaded avatar image",
  });
