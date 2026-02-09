import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { getGeneratedType } from "@tailor-platform/sdk/changeset-plugin";
import { user } from "../../tailordb/user";

const UserChangeRequest = getGeneratedType(user, "request");

const schemaType = t.object({
  ...UserChangeRequest.pickFields(["id","currentStepNo","createdAt"], { optional: true }),
  ...UserChangeRequest.omitFields(["id","currentStepNo","createdAt"]),
});

const hook = createTailorDBHook(UserChangeRequest);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"draft","references":{"table":"User","column":"id"}},
    ],
    indexes: [
      {"name":"request_record_status_idx","columns":["recordId","status"],"unique":false},
    ],
  }
);
