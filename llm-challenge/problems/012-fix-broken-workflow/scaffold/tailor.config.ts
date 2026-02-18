import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-012",
  workflow: {
    files: ["./workflows/*.ts"],
  },
});
