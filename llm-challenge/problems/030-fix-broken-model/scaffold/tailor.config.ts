import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-030",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
