import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "benchmark-002",
  resolver: {
    "my-resolver": { files: ["./resolvers/*.ts"] },
  },
});
