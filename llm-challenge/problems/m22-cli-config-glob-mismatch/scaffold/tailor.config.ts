import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      // BUG: this glob matches no files in tailordb/, so the CLI cannot find
      // any types. Adjust the extension so it matches the actual source file
      // ./tailordb/order.ts.
      files: ["./tailordb/*.tsx"],
    },
  },
});
