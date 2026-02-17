import { db } from "@tailor-platform/sdk";

export const project = db.type("Project", {
  name: db.string(),
  description: db.string({ optional: true }),
  status: db.enum(["active", "completed", "archived"]),
  ...db.fields.timestamps(),
});

export type project = typeof project;
