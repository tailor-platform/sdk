import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-020",
  workflow: {
    files: ["./workflows/**/*.ts"],
  },
});
