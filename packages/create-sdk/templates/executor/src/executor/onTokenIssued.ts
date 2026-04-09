import { createExecutor, authAccessTokenIssuedTrigger } from "@tailor-platform/sdk";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-token-issued",
  description: "Creates an audit log when an access token is issued",
  trigger: authAccessTokenIssuedTrigger(),
  operation: {
    kind: "function",
    body: async (args) => {
      await createAuditLog({
        action: "TOKEN_ISSUED",
        entityType: "AuthToken",
        entityId: args.userId,
        message: `Access token issued for user: ${args.userId}`,
      });
    },
  },
});
