import { db } from "@tailor-platform/sdk";

export const account = db
  .type("Account", {
    slug: db.string(),
  })
  .hooks({
    slug: {
      create: ({ value }) => (value ?? "").toLowerCase(),
    },
  });
