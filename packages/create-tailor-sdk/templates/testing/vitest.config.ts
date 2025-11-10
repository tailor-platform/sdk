import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    projects: [
      {
        test: {
          name: { label: "unit", color: "blue" },
          include: ["test/*.test.ts"],
        },
      },
      {
        test: {
          name: { label: "e2e", color: "green" },
          include: ["e2e/*.test.ts"],
          globalSetup: "e2e/globalSetup.ts",
        },
      },
    ],
  },
});
