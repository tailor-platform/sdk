import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  email: db.string().unique(),
});
