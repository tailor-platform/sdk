import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  db: {
    main: {
      files: ["db/**/*.ts"],
      ignores: [
        "db/**/*.draft.ts",
      ],
      migration: { directory: "./migrations" },
    },
    "shared-db": { external: true },
  },
  resolver: {
    "main-resolver": { files: ["resolvers/**/*.ts"] },
  },
  httpAdapter: {
    files: ['adapters/**/*.ts'],
  },
});
