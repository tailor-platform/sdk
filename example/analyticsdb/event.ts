import { db } from "@tailor-platform/sdk";

export const event = db
  .table("Event", {
    name: db.enum(["CLICK", "VIEW", "PURCHASE"]),
    ...db.fields.timestamps(),
  })
  .files({
    screenshot: "screenshot image",
  });
