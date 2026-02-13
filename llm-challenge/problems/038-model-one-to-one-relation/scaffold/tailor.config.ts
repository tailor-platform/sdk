import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-038",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
