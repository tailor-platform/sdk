import {
  createExecutor,
  recordCreatedTrigger,
} from "@tailor-platform/tailor-sdk";
import { user } from "../tailordb/user";

export default createExecutor(
  "user-created",
  "Triggered when a new user is created",
)
  .on(
    recordCreatedTrigger(user, ({ newRecord }) =>
      newRecord.email.endsWith("@tailor.tech"),
    ),
  )
  .executeFunction(
    async ({ newRecord, client }) => {
      const record = await client.execOne<typeof newRecord>(
        /* sql */ `select * from User where id = '${newRecord.id}'`,
      );
      console.log(`New user created: ${record.name} (${record.email})`);
    },
    { dbNamespace: "tailordb" },
  );
