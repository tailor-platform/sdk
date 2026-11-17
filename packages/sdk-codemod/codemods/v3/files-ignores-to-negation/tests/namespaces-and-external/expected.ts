import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  db: {
    main: {
      files: ["db/**/*.ts", "!db/**/*.draft.ts"],
      migration: { directory: "./migrations" },
    },
    "shared-db": { external: true },
  },
  resolver: {
    "main-resolver": { files: ["resolvers/**/*.ts", "!**/*.test.ts", "!**/*.spec.ts"] },
  },
  httpAdapter: {
    files: ['adapters/**/*.ts', '!**/*.test.ts', '!**/*.spec.ts'],
  },
});
