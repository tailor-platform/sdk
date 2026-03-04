import { createExecutor, authAccessTokenRevokedTrigger } from "@tailor-platform/sdk";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-token-revoked",
  description: "Creates an audit log when an access token is revoked",
  trigger: authAccessTokenRevokedTrigger(),
  operation: {
    kind: "function",
    body: async (args) => {
      await createAuditLog({
        action: "TOKEN_REVOKED",
        entityType: "AuthToken",
        entityId: args.userId,
        message: `Access token revoked for user: ${args.userId}`,
      });
    },
  },
});
