import { createExecutor } from "@tailor-platform/sdk";

export const onEvent = createExecutor({
  operation: {
    kind: "function",
    async body(args) {
      let label = "unknown";
      switch (args.actor?.type) {
        case "user":
          label = "user";
          break;
        case "machine_user":
          label = "machine";
          break;
        case undefined:
          label = "missing";
          break;
      }
      return {
        id: args.actor?.id,
        type: args.actor?.type,
        label,
        isUser: args.actor?.type === "user",
        isMachine: args.actor?.type === "machine_user",
        isUnspecified: args.actor?.type === undefined,
      };
    },
  },
});
