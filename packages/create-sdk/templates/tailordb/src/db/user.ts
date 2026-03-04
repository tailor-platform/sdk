import { db } from "@tailor-platform/sdk";
import { allPermission, allGqlPermission } from "./permission";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string().unique(),
    role: db.enum([
      { value: "ADMIN", description: "Administrator with full access" },
      { value: "MEMBER", description: "Regular team member" },
      { value: "VIEWER", description: "Read-only access" },
    ]),
    bio: db.string({ optional: true }).description("Short biography"),
    ...db.fields.timestamps(),
  })
  .files({ avatar: "Profile image" })
  .indexes({ fields: ["role", "createdAt"], unique: false })
  .permission(allPermission)
  .gqlPermission(allGqlPermission);
