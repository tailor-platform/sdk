import { db } from "@tailor-platform/sdk";

export const organization = db
  .type("Organization", {
    name: db.string().unique(),
    slug: db
      .string()
      .validate([
        ({ value }) => value.length > 0 && value.length <= 32,
        "slug must be between 1 and 32 characters",
      ]),
    tier: db.string(),
  })
  .hooks({
    slug: {
      update: ({ data }) => (data.slug ?? "").toLowerCase(),
    },
  })
  .permission({
    create: [],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [],
    delete: [],
  });
