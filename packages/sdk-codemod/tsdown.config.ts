import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node18",
    platform: "node",
    clean: true,
    outDir: "dist",
    tsconfig: "./tsconfig.json",
    outExtensions: () => ({
      js: ".js",
    }),
  },
  {
    entry: {
      "v2/define-generators-to-plugins/scripts/transform":
        "codemods/v2/define-generators-to-plugins/scripts/transform.ts",
      "v2/test-run-arg-input/scripts/transform":
        "codemods/v2/test-run-arg-input/scripts/transform.ts",
      "v2/sdk-skills-shim/scripts/transform": "codemods/v2/sdk-skills-shim/scripts/transform.ts",
      "v2/principal-unify/scripts/transform": "codemods/v2/principal-unify/scripts/transform.ts",
      "v2/apply-to-deploy/scripts/transform": "codemods/v2/apply-to-deploy/scripts/transform.ts",
      "v2/cli-rename/scripts/transform": "codemods/v2/cli-rename/scripts/transform.ts",
      "v2/auth-invoker-unwrap/scripts/transform":
        "codemods/v2/auth-invoker-unwrap/scripts/transform.ts",
    },
    format: ["esm"],
    target: "node18",
    platform: "node",
    outDir: "dist/codemods",
    tsconfig: "./tsconfig.json",
    outExtensions: () => ({
      js: ".js",
    }),
  },
]);
