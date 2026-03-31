import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { createBlockPlugin } from "../../plugin";

export default defineConfig({
  plugins: [createBlockPlugin()],
  test: {
    watch: false,
    environment: resolve(__dirname, "../../environment.ts"),
    setupFiles: [resolve(__dirname, "../../setup.ts")],
    include: ["./**/*.test.ts"],
    root: __dirname,
  },
});
