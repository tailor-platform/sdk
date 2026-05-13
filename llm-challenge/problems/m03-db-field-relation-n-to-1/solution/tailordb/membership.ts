import { db } from "@tailor-platform/sdk";
import { organization } from "./organization";

export const membership = db.type("Membership", {
  organizationId: db.uuid().relation({ type: "n-1", toward: { type: organization } }),
});
