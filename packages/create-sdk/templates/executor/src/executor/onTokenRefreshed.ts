import { createExecutor, authAccessTokenRefreshedTrigger } from "@tailor-platform/sdk";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-token-refreshed",
  description: "Creates an audit log when an access token is refreshed",
  trigger: authAccessTokenRefreshedTrigger(),
  operation: {
    kind: "function",
    body: async (args) => {
      await createAuditLog({
        action: "TOKEN_REFRESHED",
        entityType: "AuthToken",
        entityId: args.userId,
        message: `Access token refreshed for user: ${args.userId}`,
      });
    },
  },
});
