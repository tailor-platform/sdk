import { db } from "@tailor-platform/sdk";
import { team } from "./team";

export const project = db
  .type("Project", {
    name: db.string(),
    code: db.string().serial({ start: 1, format: "PRJ-%04d" }),
    description: db.string({ optional: true }),
    status: db.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]),
    teamId: db.uuid().relation({ type: "n-1", toward: { type: team } }),
    priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    budget: db.float({ optional: true }),
    startDate: db.date(),
    endDate: db.date({ optional: true }),
    settings: db.object({
      isPublic: db.bool(),
      allowExternalAccess: db.bool(),
      defaultAssignee: db.string({ optional: true }),
    }),
    tags: db.string({ optional: true, array: true }),
    ...db.fields.timestamps(),
  })
  .validate({
    budget: [({ value }) => value != null && value >= 0, "budget must be non-negative"],
  })
  .indexes({ fields: ["teamId", "status"] })
  .features({ aggregation: true });
export type project = typeof project;
