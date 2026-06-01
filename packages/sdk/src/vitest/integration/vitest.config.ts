import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { createBlockPlugin } from "../plugin";

const here = dirname(fileURLToPath(import.meta.url));
// `@/` target = SDK src root, two levels up; keep in sync with tsconfig `@/*`.
const sdkSrc = resolve(here, "../..");

export default defineConfig({
  plugins: [createBlockPlugin()],
  resolve: {
    // Match the SDK's main tsconfig path mapping so files reachable from the
    // tailor-runtime environment (e.g. mock.ts → configure/) can use `@/`
    // imports just like in the main test suite.
    alias: {
      "@": sdkSrc,
    },
  },
  test: {
    watch: false,
    environment: resolve(here, "../environment.ts"),
    setupFiles: [resolve(here, "../setup.ts")],
    include: ["./**/*.test.ts"],
    root: here,
  },
});
