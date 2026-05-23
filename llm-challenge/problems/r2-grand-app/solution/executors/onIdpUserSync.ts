import { createExecutor, idpUserTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "on-idp-user-sync",
  description: "Sync members when an IdP user is created or updated",
  trigger: idpUserTrigger({ idp: "my-idp", events: ["created", "updated"] }),
  operation: {
    kind: "function",
    body: async (args) => {
      console.log("IdP user event:", args.event);
    },
  },
});
