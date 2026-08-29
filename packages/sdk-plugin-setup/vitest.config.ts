import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(packageDir, "../sdk");

export default defineConfig({
  plugins: [{ name: "yaml-text", load: loadYamlText }],
  resolve: {
    alias: [
      // The generated fixture configs under the OS temp dir import
      // `@tailor-platform/sdk`, which Node cannot resolve from outside the
      // workspace. Point it at the SDK source the same way the SDK's own
      // suite does.
      {
        find: /^@tailor-platform\/sdk$/,
        replacement: path.join(sdkRoot, "src/configure/index.ts"),
      },
      { find: /^@tailor-platform\/sdk\/cli$/, replacement: path.join(sdkRoot, "src/cli/lib.ts") },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/?(*.)+(spec|test).ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
    ],
    environment: "node",
    globals: true,
    watch: false,
  },
});
