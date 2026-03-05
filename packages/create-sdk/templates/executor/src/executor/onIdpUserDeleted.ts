import { createExecutor, idpUserDeletedTrigger } from "@tailor-platform/sdk";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-idp-user-deleted",
  description: "Creates an audit log when an IdP user is deleted",
  trigger: idpUserDeletedTrigger(),
  operation: {
    kind: "function",
    body: async (args) => {
      await createAuditLog({
        action: "IDP_USER_DELETED",
        entityType: "IdpUser",
        entityId: args.userId,
        message: `IdP user deleted from namespace: ${args.namespaceName}`,
      });
    },
  },
});
