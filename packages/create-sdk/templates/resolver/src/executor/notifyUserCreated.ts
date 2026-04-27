import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { user } from "../db/user";

const executor = createExecutor({
  name: "notifyUserCreated",
  description: "Logs a notification when a new user is created",
  trigger: recordCreatedTrigger({ type: user }),
  operation: {
    kind: "function",
    body: ({ newRecord }) => {
      console.log(`New user created: ${newRecord.name} (${newRecord.email})`);
    },
  },
});

export default executor;
