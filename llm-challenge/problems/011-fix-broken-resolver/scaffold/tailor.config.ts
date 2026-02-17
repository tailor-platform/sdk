import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-011",
  resolver: {
    "my-resolver": { files: ["./resolvers/**/resolver.ts"] },
  },
});
