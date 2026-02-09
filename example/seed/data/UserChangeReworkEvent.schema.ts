import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { getGeneratedType } from "@tailor-platform/sdk/changeset-plugin";
import { user } from "../../tailordb/user";

const UserChangeReworkEvent = getGeneratedType(user, "rework");

const schemaType = t.object({
  ...UserChangeReworkEvent.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeReworkEvent.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeReworkEvent);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"request","references":{"table":"UserChangeRequest","column":"id"}},
    ],
  }
);
