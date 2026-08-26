import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          globalSetup: ["./vitest.global-setup.ts"],
        },
      },
    ],
  },
});
