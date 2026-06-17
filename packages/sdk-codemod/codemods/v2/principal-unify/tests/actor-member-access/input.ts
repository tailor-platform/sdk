import { createExecutor } from "@tailor-platform/sdk";

export const onEvent = createExecutor({
  operation: {
    kind: "function",
    async body(args) {
      return {
        id: args.actor?.userId,
        type: args.actor?.userType,
        isUser: args.actor?.userType === "USER_TYPE_USER",
        isMachine: args.actor?.userType === "USER_TYPE_MACHINE_USER",
        isUnspecified: args.actor?.userType === "USER_TYPE_UNSPECIFIED",
      };
    },
  },
});
