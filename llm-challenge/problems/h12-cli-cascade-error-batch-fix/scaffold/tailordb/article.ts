import { db } from "@tailor-platform/sdk";

export const article = db.type("Article", {
  title: db.text(),
  summary: db.text(),
});
