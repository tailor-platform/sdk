import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-002",
  resolver: {
    "my-resolver": { files: ["./resolvers/*.ts"] },
  },
});
