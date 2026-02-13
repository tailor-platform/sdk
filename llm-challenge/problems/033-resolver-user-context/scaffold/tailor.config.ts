import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-033",
  resolver: {
    "my-resolver": { files: ["./resolvers/**/resolver.ts"] },
  },
});
