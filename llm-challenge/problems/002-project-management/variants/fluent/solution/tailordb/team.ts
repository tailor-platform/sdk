import { db } from "@tailor-platform/sdk";

export const team = db
  .type("Team", {
    name: db.string().unique(),
    code: db.string().serial({ start: 1, format: "TEAM-%03d" }),
    description: db.string({ optional: true }),
    maxMembers: db.int({ optional: true }),
    isActive: db.bool({ optional: true }),
    ...db.fields.timestamps(),
  })
  .hooks({
    maxMembers: { create: ({ value }) => value ?? 10 },
    isActive: { create: ({ value }) => value ?? true },
  })
  .validate({
    maxMembers: [({ value }) => value != null && value > 0, "maxMembers must be positive"],
  })
  .description("Team entity for project management")
  .permission({
    create: [[{ user: "_loggedIn" }, "=", true]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ user: "role" }, "=", "ADMIN"]],
    delete: [[{ user: "role" }, "=", "ADMIN"]],
  });
export type team = typeof team;
