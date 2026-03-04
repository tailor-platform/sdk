import { db } from "@tailor-platform/sdk";

export const tenant = db.type("Tenant", {
  name: db.string(),
  slug: db.string().unique(),
  plan: db.enum(["free", "pro", "enterprise"]),
  ...db.fields.timestamps(),
});

export type tenant = typeof tenant;
