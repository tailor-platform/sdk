import { db } from "@tailor-platform/sdk";

export const attachedFiles = db.object(
  {
    id: db.uuid(),
    name: db.string(),
    size: db.int().validate(({ value }) => value > 0),
    type: db.enum("text", "image"),
  },
  { array: true },
);
