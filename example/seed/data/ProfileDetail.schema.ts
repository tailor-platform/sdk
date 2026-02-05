import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { profileDetail } from "../../tailordb/profileReference";

const schemaType = t.object({
  ...profileDetail.pickFields(["id","createdAt"], { optional: true }),
  ...profileDetail.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(profileDetail);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"profileID","references":{"table":"NestedProfile","column":"id"}},
    ],
    indexes: [
      {"name":"profiledetail_profileID_unique_idx","columns":["profileID"],"unique":true},
    ],
  }
);
