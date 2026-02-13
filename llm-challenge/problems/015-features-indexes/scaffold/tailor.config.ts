import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-015",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
