import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importPlugin from "eslint-plugin-import-x";
import jsdocPlugin from "eslint-plugin-jsdoc";
import oxlint from "eslint-plugin-oxlint";
import localPlugin from "./eslint-rules/index.js";

// Derive public API entry point source files from package.json#exports
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"));
const publicApiEntryPoints = Object.values(pkg.exports)
  .map((exp) => exp.types)
  .filter(Boolean)
  .map((p) => p.replace(/^\.\/dist\//, "src/").replace(/\.d\.mts$/, ".ts"));

export default defineConfig([
  globalIgnores([
    "dist/",
    "e2e/fixtures/",
    ".tailor-sdk/",
    "tailor.d.ts",
    "plugin-defined.d.ts",
    "**/__test_fixtures__/",
  ]),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
  },
  jsdocPlugin.configs["flat/recommended"],
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns-type": "off",
      "jsdoc/tag-lines": "error",
      "jsdoc/check-param-names": "error",
      // Existence enforcement handled by local/require-public-api-jsdoc rule
      // (validates only public API entry points from package.json#exports).
      // require-param and require-returns remain: they only fire when JSDoc exists.
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param": "error",
      "jsdoc/require-returns": "error",
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.ts", "tsdown.config.ts", "vitest.config.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import-x/no-cycle": ["error", { maxDepth: Infinity }],
      "import-x/no-unresolved": "off",
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          pathGroups: [
            {
              pattern: "@/**",
              group: "internal",
              position: "before",
            },
          ],
          pathGroupsExcludedImportTypes: ["type"],
          "newlines-between": "never",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
          distinctGroup: false,
        },
      ],
    },
  },
  {
    files: ["src/types/**/*.ts"],
    ignores: ["src/types/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/configure/**", "@/configure/**"],
              message: "Types module should not import from configure module.",
            },
            {
              group: ["**/cli/**", "@/cli/**"],
              message: "Types module should not import from cli module.",
            },
            {
              group: ["**/parser/**", "@/parser/**"],
              message: "Types module should not import from parser module.",
            },
            {
              group: ["**/plugin/**", "@/plugin/**"],
              message: "Types module should not import from plugin module.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/configure/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "@/cli/**"],
              message: "Configure module should not import from cli module.",
            },
            {
              group: ["**/parser/**", "@/parser/**"],
              message:
                "Configure module should not import from parser module. Use @/types/ instead.",
            },
            {
              group: ["**/plugin/**", "@/plugin/**"],
              message: "Configure module should not import from plugin module.",
            },
            {
              group: [
                "**/utils/**",
                "@/utils/**",
                "!**/utils/brand",
                "!@/utils/brand",
                "!**/utils/test/**",
                "!@/utils/test/**",
              ],
              message: "Configure module can only import `brand` or `test/*` from utils module.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/parser/**/*.ts"],
    ignores: ["src/parser/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "@/cli/**"],
              message: "Parser module should not import from cli module.",
            },
            {
              group: ["**/configure/**", "@/configure/**"],
              message: "Parser module should not import from configure module.",
            },
          ],
        },
      ],
    },
  },
  {
    // Built-in plugins can import from configure module
    files: ["src/plugin/builtin/**/*.ts"],
    ignores: ["src/plugin/builtin/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "@/cli/**"],
              message: "Plugin builtin module should not import from cli module.",
            },
          ],
        },
      ],
    },
  },
  {
    // Non-builtin plugin modules cannot import from configure or builtin
    files: ["src/plugin/**/*.ts"],
    ignores: ["src/plugin/**/*.test.ts", "src/plugin/builtin/**/*.ts", "src/plugin/manager.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "@/cli/**"],
              message: "Plugin module should not import from cli module.",
            },
            {
              group: ["**/configure/**", "@/configure/**"],
              message:
                "Plugin module should not import from configure module. Please use parser module as an intermediary.",
            },
            {
              group: ["**/plugin/builtin/**", "@/plugin/builtin/**"],
              message:
                "Plugin module should not import from builtin plugins. Built-in plugins are exported separately.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/parser/**/types.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**"],
              allowTypeImports: true,
              message: "types.ts can import only types.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/cli/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/configure/**", "@/configure/**"],
              message:
                "Cli module should not import from configure module. Please use parser module as an intermediary.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/cli/**/*.ts"],
    ignores: [
      "src/cli/shared/logger.ts",
      "src/cli/shared/errors.ts",
      "src/cli/shared/format.ts",
      "src/cli/shared/prompt.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:util",
              importNames: ["styleText"],
              message:
                "Use colors/symbols/logger from '@/cli/shared/logger' instead of styleText for consistent styling.",
            },
            {
              name: "chalk",
              message:
                "Use colors/symbols/logger from '@/cli/shared/logger' instead of chalk for consistent styling.",
            },
            {
              name: "table",
              message:
                "Use formatTable/formatKeyValueTable/formatTableWithHeaders from '@/cli/shared/format' instead of table for consistent table styling.",
            },
            {
              name: "path",
              message: "Use 'pathe' instead of 'path' for consistent cross-platform path handling.",
            },
            {
              name: "node:path",
              message:
                "Use 'pathe' instead of 'node:path' for consistent cross-platform path handling.",
            },
            {
              name: "@inquirer/prompts",
              message:
                "Use 'prompt' from '@/cli/shared/prompt' instead of @inquirer/prompts directly.",
            },
            {
              name: "@inquirer/core",
              message:
                "Use 'prompt' from '@/cli/shared/prompt' instead of @inquirer/core directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/cli/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(log|error|warn|info|debug)$/]",
          message:
            "Use logger from '@/cli/shared/logger' instead of console for consistent logging. Use printData for JSON output.",
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toMatchTypeOf']",
          message:
            "toMatchTypeOf is deprecated. Use toEqualTypeOf, toMatchObjectType, or toExtend instead.",
        },
      ],
    },
  },
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "import-x/no-unresolved": "off",
    },
  },
  {
    // This rule uses the TypeScript type checker to resolve re-exported symbols,
    // so `eslint --cache` may serve stale results when only a re-export source
    // file changes (the entry point's mtime stays the same). This is a known
    // limitation of ESLint's file-level cache with any cross-file type-aware
    // rule. CI runs on a clean cache, so it always catches violations.
    files: publicApiEntryPoints,
    plugins: { local: localPlugin },
    rules: {
      "local/require-public-api-jsdoc": "error",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "import-x/no-unresolved": "off",
    },
  },
  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
]);
