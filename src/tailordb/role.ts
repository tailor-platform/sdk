import { db, t } from "@tailor-platform/tailor-sdk";

export const role = db.type(
  "Role",
  {
    name: db.string(),
  },
  { withTimestamps: true },
);
export type role = typeof role;
export type Role = t.infer<role>;
