import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.tsx"],
    },
  },
});
