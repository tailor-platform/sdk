import { db } from "@tailor-platform/sdk";
import { allPermission, allGqlPermission } from "./permission";

export const category = db
  .table("Category", "Task category with hierarchical structure", {
    name: db.string(),
    description: db.string({ optional: true }),
    parentCategoryId: db.uuid({ optional: true }).relation({
      type: "n-1",
      toward: { type: "self" },
      backward: "children",
    }),
  })
  .permission(allPermission)
  .gqlPermission(allGqlPermission);
