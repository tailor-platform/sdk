import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-004",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
