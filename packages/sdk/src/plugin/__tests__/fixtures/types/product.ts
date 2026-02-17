// oxlint-disable no-restricted-imports -- Test fixture requires configure imports
import { db } from "@/configure/services/tailordb";

export const product = db
  .type("Product", {
    name: db.string(),
    price: db.int(),
  })
  .plugin({ "@tailor-platform/changeset": true } as Record<string, unknown>);
