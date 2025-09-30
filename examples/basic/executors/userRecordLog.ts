import { SqlClient, t } from "@tailor-platform/tailor-sdk";
import { user } from "tailordb/user";

export default async ({
  newRecord,
  client,
}: {
  newRecord: t.infer<typeof user>;
  client: SqlClient;
}) => {
  const record = await client.execOne<typeof newRecord>(
    /* sql */ `select * from User where id = ?`,
    [newRecord.id],
  );
  console.log(`New user created: ${record.name} (${record.email})`);
};
