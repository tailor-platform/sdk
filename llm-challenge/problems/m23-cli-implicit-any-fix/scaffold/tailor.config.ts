import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  resolver: {
    "lookup-role": { files: ["./resolvers/*.ts"] },
  },
});
