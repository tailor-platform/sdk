import { createExecutor, idpUserUpdatedTrigger } from "@tailor-platform/sdk";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-idp-user-updated",
  description: "Creates an audit log when an IdP user profile is updated",
  trigger: idpUserUpdatedTrigger(),
  operation: {
    kind: "function",
    body: async (args) => {
      await createAuditLog({
        action: "IDP_USER_UPDATED",
        entityType: "IdpUser",
        entityId: args.userId,
        message: `IdP user updated in namespace: ${args.namespaceName}`,
      });
    },
  },
});
