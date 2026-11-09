import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  workflow: {
    files: ["workflows/**/*.ts"],
  },
});
