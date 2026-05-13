import { db } from "@tailor-platform/sdk";

export const document = db
  .type("Document", {
    title: db.string(),
    slug: db.string(),
    version: db.int(),
  })
  .hooks({
    title: {
      update: ({ value }) => (value ?? "").trim(),
    },
    slug: {
      update: ({ value }) => (value ?? "").toLowerCase(),
    },
    version: {
      update: ({ value }) => (value ?? 0) + 1,
    },
  });
