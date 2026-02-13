import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-023",
  resolver: {
    "my-resolver": { files: ["./resolvers/*.ts"] },
  },
});
