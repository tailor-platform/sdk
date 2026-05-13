import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["core/**/*.test.ts", "problems/*/tests/**/*.test.ts"],
        },
      },
    ],
  },
});
