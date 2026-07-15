import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "creator-profiles",
  db: {
    profiles: {
      files: ["tailordb/**/*.ts"],
    },
  },
});
