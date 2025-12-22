import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tailor-proto": path.resolve(__dirname, "../tailor-proto/src"),
    },
  },
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
    globals: true,
    watch: false,
    typecheck: { enabled: true },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
    },
  },
});
