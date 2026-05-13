import { db } from "@tailor-platform/sdk";

export const account = db.type("Account", {
  tier: db.string(),
});
