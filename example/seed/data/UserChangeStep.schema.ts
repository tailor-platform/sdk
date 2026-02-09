import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { getGeneratedType } from "@tailor-platform/sdk/changeset-plugin";
import { user } from "../../tailordb/user";

const UserChangeStep = getGeneratedType(user, "step");

const schemaType = t.object({
  ...UserChangeStep.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeStep.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeStep);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"request","references":{"table":"UserChangeRequest","column":"id"}},
    ],
  }
);
