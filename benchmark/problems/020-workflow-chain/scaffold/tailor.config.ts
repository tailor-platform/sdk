import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "benchmark-020",
  workflow: {
    files: ["./workflows/**/*.ts"],
  },
});
