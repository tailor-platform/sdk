import { createExecutor, idpUserCreatedTrigger } from "@tailor-platform/sdk";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-idp-user-created",
  description: "Creates an audit log when an IdP user registers",
  trigger: idpUserCreatedTrigger(),
  operation: {
    kind: "function",
    body: async (args) => {
      await createAuditLog({
        action: "IDP_USER_CREATED",
        entityType: "IdpUser",
        entityId: args.userId,
        message: `IdP user registered in namespace: ${args.namespaceName}`,
      });
    },
  },
});
