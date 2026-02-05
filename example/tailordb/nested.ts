import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";
import { user } from "./user";

export const nestedProfile = db
  .type("NestedProfile", "Nested Profile Type", {
    userInfo: db
      .object({
        name: db.string().description("User's full name"),
        age: db.int({ optional: true }).description("User's age"),
        bio: db.string({ optional: true }).description("User's biography"),
        email: db.string().description("User's email address"),
        phone: db.string({ optional: true }).description("User's phone number"),
      })
      .description("User information"),
    metadata: db
      .object({
        created: db.datetime().description("Creation timestamp"),
        lastUpdated: db.datetime({ optional: true }).description("Last update timestamp"),
        version: db.int().description("Version number"),
      })
      .description("Profile metadata"),
    archived: db.bool({ optional: true }).description("Archive status"),
    ownerID: db.uuid({ optional: true }).relation({
      type: "n-1",
      toward: { type: user, as: "owner" },
    }),
    ...db.fields.timestamps(),
  })
  .files({ avatar: "profile avatar image" })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
