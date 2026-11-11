import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  resolver: {
    main: { files: ["resolvers/**/*.ts"] },
    admin: { files: ['admin/**/*.ts', '!admin/**/*.draft.ts'] },
  },
});
