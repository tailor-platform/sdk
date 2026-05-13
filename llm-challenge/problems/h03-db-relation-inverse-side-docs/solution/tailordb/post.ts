import { db } from "@tailor-platform/sdk";
import { author } from "./author";

export const post = db.type("Post", {
  title: db.string(),
  authorId: db.uuid().relation({
    type: "n-1",
    toward: { type: author, as: "posts" },
    backward: "author",
  }),
});
