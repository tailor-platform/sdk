import { createExecutor, recordCreatedTrigger, t } from "@tailor-platform/sdk";
import { user } from "../db/user";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-user-created",
  description: "Creates an audit log when a new admin user is created",
  trigger: recordCreatedTrigger({
    type: user,
    condition: ({ newRecord }) => newRecord.role === "ADMIN",
  }),
  operation: {
    kind: "function",
    body: async (args: { newRecord: t.infer<typeof user> }) => {
      await createAuditLog({
        action: "USER_CREATED",
        entityType: "User",
        entityId: args.newRecord.id,
        message: `Admin user created: ${args.newRecord.name} (${args.newRecord.email})`,
      });
    },
  },
});
