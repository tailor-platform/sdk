import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { user } from "../tailordb/user";
import userRecordLog from "./userRecordLog";

export default createExecutor({
  name: "user-created",
  description: "Triggered when a new user is created",
  trigger: recordCreatedTrigger({
    type: user,
    condition: ({ newRecord }) => newRecord.email.endsWith("@tailor.tech"),
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      await userRecordLog(args);
    },
  },
});
