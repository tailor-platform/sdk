import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/index.test.ts", "src/package.test.ts", "src/rules/*.test.ts"],
        },
      },
    ],
  },
});
