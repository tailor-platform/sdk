import { createExecutor, recordUpdatedTrigger, t } from "@tailor-platform/sdk";
import { user } from "../db/user";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-user-updated",
  description: "Creates an audit log when a user is updated",
  trigger: recordUpdatedTrigger({
    type: user,
  }),
  operation: {
    kind: "function",
    body: async (args: { newRecord: t.infer<typeof user>; oldRecord: t.infer<typeof user> }) => {
      await createAuditLog({
        action: "USER_UPDATED",
        entityType: "User",
        entityId: args.newRecord.id,
        message: `User updated: ${args.oldRecord.name} -> ${args.newRecord.name}`,
      });
    },
  },
});
