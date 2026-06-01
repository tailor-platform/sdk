import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { createBlockPlugin } from "../plugin";

const here = dirname(fileURLToPath(import.meta.url));
// `here` is `src/vitest/integration`; the SDK source root (`@/` target) is two
// levels up at `src`. Keep in sync with the SDK tsconfig `@/*` mapping.
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
