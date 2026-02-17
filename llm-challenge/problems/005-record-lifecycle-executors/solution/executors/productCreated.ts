import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { product } from "../tailordb/product";

export default createExecutor({
  name: "product-created",
  description: "Triggered when a new product is created",
  trigger: recordCreatedTrigger({
    type: product,
  }),
  operation: {
    kind: "function",
    body: async ({ newRecord }) => {
      console.log(`Product created: ${newRecord.name} ($${newRecord.price})`);
    },
  },
});
