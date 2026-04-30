import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { createBlockPlugin } from "../../plugin";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [createBlockPlugin()],
  test: {
    watch: false,
    environment: resolve(here, "../../environment.ts"),
    setupFiles: [resolve(here, "../../setup.ts")],
    include: ["./**/*.test.ts"],
    root: here,
  },
});
