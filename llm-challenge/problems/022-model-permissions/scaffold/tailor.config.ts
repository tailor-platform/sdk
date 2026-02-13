import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-022",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
