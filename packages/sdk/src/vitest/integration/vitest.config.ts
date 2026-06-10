import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { createBlockPlugin } from "../plugin";

const here = dirname(fileURLToPath(import.meta.url));
// `@/` target = SDK src root (two levels up); mock.ts and its deps use `@/` imports.
const sdkSrc = resolve(here, "../..");

export default defineConfig({
  plugins: [createBlockPlugin()],
  resolve: { alias: { "@": sdkSrc } },
  test: {
    watch: false,
    environment: resolve(here, "../environment.ts"),
    setupFiles: [resolve(here, "../setup.ts")],
    include: ["./**/*.test.ts"],
    root: here,
  },
});
