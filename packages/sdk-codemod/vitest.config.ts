import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/?(*.)+(spec|test).ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
    ],
    environment: "node",
    globals: true,
    watch: false,
  },
});
