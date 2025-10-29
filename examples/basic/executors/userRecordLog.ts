import { user } from "tailordb/user";
import { t } from "@tailor-platform/tailor-sdk";
import { getDB } from "generated/tailordb";

export default async ({ newRecord }: { newRecord: t.infer<typeof user> }) => {
  const db = getDB("tailordb");
  const record = await db
    .selectFrom("User")
    .selectAll()
    .where("id", "=", newRecord.id)
    .executeTakeFirst();
  console.log(`New user created: ${record?.name} (${record?.email})`);
};
