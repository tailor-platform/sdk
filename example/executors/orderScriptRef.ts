import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { salesOrder } from "../tailordb/salesOrder";

export default createExecutor({
  name: "order-scriptref",
  description: "Process order using Function Registry",
  trigger: recordCreatedTrigger({ type: salesOrder }),
  operation: {
    kind: "function",
    scriptRef: "processOrder",
  },
});
