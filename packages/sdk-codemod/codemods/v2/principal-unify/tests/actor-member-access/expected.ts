import { createExecutor } from "@tailor-platform/sdk";

export const onEvent = createExecutor({
  operation: {
    kind: "function",
    async body(args) {
      return {
        id: args.actor?.id,
        type: args.actor?.type,
        isUser: args.actor?.type === "user",
        isMachine: args.actor?.type === "machine_user",
        isUnspecified: args.actor?.type === undefined,
      };
    },
  },
});
