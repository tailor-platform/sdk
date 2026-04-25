import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    projects: [
      {
        test: {
          name: { label: "unit", color: "blue" },
          include: ["src/**/*.test.ts"],
        },
      },
    ],
  },
});
