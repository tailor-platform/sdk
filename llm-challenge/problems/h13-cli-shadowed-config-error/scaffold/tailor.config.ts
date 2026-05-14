import { defineConfig } from "@tailor-platform/sdk";

export const config = defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
});
