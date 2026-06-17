import { db } from "@tailor-platform/sdk";

export const role = db.string().hooks({
  create: ({ user: { id } }) => id,
});
