import { db } from "@tailor-platform/sdk";
import { author } from "./author";

export const book = db.type("Book", {
  title: db.string(),
  isbn: db.string().unique(),
  price: db.int({ optional: true }),
  authorID: db.uuid().relation({ type: "n-1", toward: { type: author } }),
  ...db.fields.timestamps(),
});

export type book = typeof book;
