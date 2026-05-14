import { db } from "@tailor-platform/sdk";

export const note = db.type("Note", {
  heading: db.text(),
  body: db.text(),
});
