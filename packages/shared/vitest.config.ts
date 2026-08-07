import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/?(*.)+(spec|test).ts"],
          exclude: ["**/node_modules/**"],
        },
      },
    ],
    environment: "node",
    globals: true,
    watch: false,
  },
});
