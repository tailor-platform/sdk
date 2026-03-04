import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import processData from "../resolver/processData";
import { createAuditLog } from "./shared";

export default createExecutor({
  name: "on-data-processed",
  description: "Creates an audit log when data is processed",
  trigger: resolverExecutedTrigger({
    resolver: processData,
    condition: ({ result }) => {
      if (!result) return false;
      return result.processed;
    },
  }),
  operation: {
    kind: "function",
    body: async () => {
      await createAuditLog({
        action: "DATA_PROCESSED",
        entityType: "Resolver",
        entityId: "00000000-0000-0000-0000-000000000000",
        message: "Data processing completed",
      });
    },
  },
});
