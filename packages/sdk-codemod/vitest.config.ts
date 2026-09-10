import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
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
