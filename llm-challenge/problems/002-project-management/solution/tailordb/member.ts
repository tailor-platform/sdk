import { createType, timestampFields } from "@tailor-platform/sdk";
import { team } from "./team";

export const member = createType("Member", {
  name: { kind: "string" },
  email: {
    kind: "string",
    unique: true,
    hooks: {
      create: ({ value }) => (value ? value.toLowerCase() : ""),
      update: ({ value }) => (value ? value.toLowerCase() : ""),
    },
  },
  role: {
    kind: "enum",
    values: [
      { value: "OWNER", description: "Team owner with full control" },
      { value: "ADMIN", description: "Administrator" },
      { value: "MEMBER", description: "Regular team member" },
      { value: "VIEWER", description: "Read-only access" },
    ],
  },
  teamId: {
    kind: "uuid",
    relation: { type: "n-1", toward: { type: team } },
  },
  joinedAt: {
    kind: "datetime",
    optional: true,
    hooks: { create: () => new Date() },
  },
  skills: { kind: "string", array: true, optional: true },
  ...timestampFields(),
});
export type member = typeof member;
