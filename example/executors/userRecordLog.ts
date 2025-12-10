import { t } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";
import { user } from "../tailordb/user";

export default async ({ newRecord }: { newRecord: t.infer<typeof user> }) => {
  const db = getDB("tailordb");
  const record = await db
    .selectFrom("User")
    .selectAll()
    .where("id", "=", newRecord.id)
    .executeTakeFirst();

  await db
    .insertInto("UserLog")
    .values({
      userID: newRecord.id,
      message: `User created: ${record?.name} (${record?.email})`,
    })
    .execute();
};
