import {
  createExecutor,
  recordCreatedTrigger,
} from "@tailor-platform/tailor-sdk";
import { user } from "../tailordb/user";
import userRecordLog from "./userRecordLog";

export default createExecutor(
  "user-created",
  "Triggered when a new user is created",
)
  .on(
    recordCreatedTrigger(user, ({ newRecord }) =>
      newRecord.email.endsWith("@tailor.tech"),
    ),
  )
  .executeFunction({
    fn: async (args) => {
      await userRecordLog(args);
    },
    dbNamespace: "tailordb",
  });
