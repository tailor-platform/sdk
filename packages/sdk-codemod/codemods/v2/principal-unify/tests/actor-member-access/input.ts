import { createExecutor } from "@tailor-platform/sdk";

export const onEvent = createExecutor({
  operation: {
    kind: "function",
    async body(args) {
      let label = "unknown";
      switch (args.actor?.userType) {
        case "USER_TYPE_USER":
          label = "user";
          break;
        case "USER_TYPE_MACHINE_USER":
          label = "machine";
          break;
        case "USER_TYPE_UNSPECIFIED":
          label = "missing";
          break;
      }
      return {
        id: args.actor?.userId,
        type: args.actor?.userType,
        label,
        isUser: args.actor?.userType === "USER_TYPE_USER",
        isMachine: args.actor?.userType === "USER_TYPE_MACHINE_USER",
        isUnspecified: args.actor?.userType === "USER_TYPE_UNSPECIFIED",
      };
    },
  },
});
