import { createExecutor, recordDeletedTrigger, t } from "@tailor-platform/sdk";
import { user } from "../db/user";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-user-deleted",
  description: "Creates an audit log when a user is deleted",
  trigger: recordDeletedTrigger({
    type: user,
  }),
  operation: {
    kind: "function",
    body: async (args: { oldRecord: t.infer<typeof user> }) => {
      await createAuditLog({
        action: "USER_DELETED",
        entityType: "User",
        entityId: args.oldRecord.id,
        message: `User deleted: ${args.oldRecord.name} (${args.oldRecord.email})`,
      });
    },
  },
});
