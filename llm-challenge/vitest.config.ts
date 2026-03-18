import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["problems/*/tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
