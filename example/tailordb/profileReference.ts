import { db } from "@tailor-platform/sdk";
import { nestedProfile } from "./nested";
import { defaultPermission } from "./permissions";

// Test type for backward relation testing
// n-1 relation to NestedProfile (creates backward relation on NestedProfile)
export const profileComment = db
  .type("ProfileComment", "Comment on a profile", {
    content: db.string().description("Comment content"),
    profileID: db
      .uuid()
      .relation({
        type: "n-1",
        toward: { type: nestedProfile, as: "profile" },
        backward: "comments",
      })
      .description("Referenced profile"),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission);

// 1-1 relation to NestedProfile (creates backward relation on NestedProfile)
export const profileDetail = db
  .type("ProfileDetail", "Additional detail for a profile", {
    bio: db.string({ optional: true }).description("Extended biography"),
    profileID: db
      .uuid()
      .relation({
        type: "1-1",
        toward: { type: nestedProfile, as: "profile" },
        backward: "detail",
      })
      .description("Referenced profile"),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission);
