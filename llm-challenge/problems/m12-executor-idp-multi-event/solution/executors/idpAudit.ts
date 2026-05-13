import { createExecutor, idpUserTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "idp-user-audit",
  description: "Triggered when an IdP user is created or deleted",
  trigger: idpUserTrigger({
    events: ["created", "deleted"],
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      console.log(`idp user ${args.event}:`, args.userId);
    },
  },
});
