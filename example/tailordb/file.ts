import { db } from "@tailor-platform/sdk";

export const attachedFiles = db.object(
  {
    id: db.uuid(),
    name: db.string(),
    size: db.int(),
    type: db.enum(["text", "image"]),
  },
  { array: true },
);
