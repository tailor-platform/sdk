import { db } from "@tailor-platform/sdk";
import { team } from "./team";

export const member = db
  .type("Member", {
    name: db.string(),
    email: db.string().unique(),
    role: db.enum([
      { value: "OWNER", description: "Team owner with full control" },
      { value: "ADMIN", description: "Administrator" },
      { value: "MEMBER", description: "Regular team member" },
      { value: "VIEWER", description: "Read-only access" },
    ]),
    teamId: db.uuid().relation({ type: "n-1", toward: { type: team } }),
    joinedAt: db.datetime({ optional: true }),
    skills: db.string({ optional: true, array: true }),
    ...db.fields.timestamps(),
  })
  .hooks({
    email: {
      create: ({ value }) => (value ? value.toLowerCase() : ""),
      update: ({ value }) => (value ? value.toLowerCase() : ""),
    },
    joinedAt: { create: () => new Date() },
  });
export type member = typeof member;
