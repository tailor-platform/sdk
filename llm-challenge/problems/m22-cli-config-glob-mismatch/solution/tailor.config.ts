import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      // Match the actual source file ./tailordb/order.ts.
      files: ["./tailordb/*.ts"],
    },
  },
});
