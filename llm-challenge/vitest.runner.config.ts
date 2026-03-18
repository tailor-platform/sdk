import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["runner/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
