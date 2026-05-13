import { db } from "@tailor-platform/sdk";

export const note = db.type("Note", {
  heading: db.string(),
  body: db.string(),
});
