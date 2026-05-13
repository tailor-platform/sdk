import { db } from "@tailor-platform/sdk";

export const organization = db.type("Organization", {
  name: db.string(),
});
