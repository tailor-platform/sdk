import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "micro-challenge",
  workflow: { files: ["./workflows/**/*.ts"] },
});
