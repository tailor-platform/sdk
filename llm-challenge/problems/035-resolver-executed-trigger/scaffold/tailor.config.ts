import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-035",
  resolver: {
    "my-resolver": { files: ["./resolvers/**/resolver.ts"] },
  },
  executor: {
    files: ["./executors/*.ts"],
  },
});
