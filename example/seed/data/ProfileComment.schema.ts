import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { profileComment } from "../../tailordb/profileReference";

const schemaType = t.object({
  ...profileComment.pickFields(["id","createdAt"], { optional: true }),
  ...profileComment.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(profileComment);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"profileID","references":{"table":"NestedProfile","column":"id"}},
    ],
  }
);
