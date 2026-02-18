import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-007",
  workflow: {
    files: ["./workflows/**/*.ts"],
  },
});
