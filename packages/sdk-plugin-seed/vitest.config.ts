import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/?(*.)+(spec|test).ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["e2e/**/*.test.ts"],
          testTimeout: 120000,
          hookTimeout: 300000,
          globalSetup: ["e2e/globalSetup.ts"],
        },
      },
    ],
    environment: "node",
    globals: true,
    watch: false,
  },
});
