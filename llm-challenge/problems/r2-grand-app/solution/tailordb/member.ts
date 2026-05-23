import { db } from "@tailor-platform/sdk";
import { organization } from "./organization";

export const member = db
  .type("Member", {
    organizationId: db.uuid().relation({ type: "n-1", toward: { type: organization } }),
    email: db.string().unique(),
    role: db.string(),
    roles: db.string({ array: true }),
  })
  .indexes({ fields: ["organizationId", "email"], unique: false });
