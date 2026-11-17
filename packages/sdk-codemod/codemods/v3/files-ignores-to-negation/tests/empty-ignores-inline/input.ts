import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  resolver: {
    main: { files: ["resolvers/**/*.ts"], ignores: [] },
    admin: { ignores: ['admin/**/*.draft.ts'], files: ['admin/**/*.ts'] },
  },
});
