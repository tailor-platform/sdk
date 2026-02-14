import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import updateProduct from "../resolvers/updateProduct/resolver";

export default createExecutor({
  name: "sync-product-data",
  description: "Syncs product data to external system after update",
  trigger: resolverExecutedTrigger({
    resolver: updateProduct,
    condition: ({ success }) => success,
  }),
  operation: {
    kind: "graphql",
    appName: "external-sync-app",
    query: `mutation SyncProduct($id: ID!, $name: String!, $price: Float!) {
      syncProduct(input: { id: $id, name: $name, price: $price }) {
        success
      }
    }`,
    variables: (args) => {
      if (args.success) {
        return {
          id: args.result.id,
          name: args.result.id,
          price: 0,
        };
      }
      return {};
    },
    authInvoker: {
      namespace: "app-auth",
      machineUserName: "sync-worker",
    },
  },
});
