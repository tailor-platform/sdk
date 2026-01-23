import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import jsdoc from "eslint-plugin-jsdoc";
import oxlint from "eslint-plugin-oxlint";

export default defineConfig([
  globalIgnores(["dist/"]),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  jsdoc.configs["flat/recommended"],
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns-type": "off",
      "jsdoc/tag-lines": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/require-jsdoc": ["error", { publicOnly: true }],
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
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import/no-cycle": ["error", { maxDepth: Infinity }],
      "import/no-unresolved": "off",
      "import/order": [
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
              message: "Configure module should not import from parser module.",
            },
            {
              group: ["**/parser/**/types", "@/parser/**/types"],
              allowTypeImports: true,
              message: "Configure module should not import from parser module.",
            },
            {
              group: ["zod"],
              allowTypeImports: true,
              message: "Configure module can import only types from zod module.",
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
    files: ["src/plugin/**/*.ts"],
    ignores: ["src/plugin/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "@/cli/**"],
              message: "Plugin module should not import from cli module.",
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
  // {
  //   files: ["src/cli/**/*.ts"],
  //   rules: {
  //     "@typescript-eslint/no-restricted-imports": [
  //       "error",
  //       {
  //         patterns: [
  //           {
  //             group: ["**/configure/**", "@/configure/**"],
  //             message: "Cli module should not import from configure module. Please use parser module as an intermediary.",
  //           },
  //         ],
  //       },
  //     ],
  //   },
  // },
  {
    files: ["src/cli/**/*.ts"],
    ignores: ["src/cli/utils/logger.ts", "src/cli/utils/errors.ts", "src/cli/utils/format.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:util",
              importNames: ["styleText"],
              message:
                "Use colors/symbols/logger from '@/cli/utils/logger' instead of styleText for consistent styling.",
            },
            {
              name: "chalk",
              message:
                "Use colors/symbols/logger from '@/cli/utils/logger' instead of chalk for consistent styling.",
            },
            {
              name: "consola",
              message:
                "Use logger from '@/cli/utils/logger' instead of consola for consistent logging.",
            },
            {
              name: "table",
              message:
                "Use formatTable/formatKeyValueTable/formatTableWithHeaders from '@/cli/utils/format' instead of table for consistent table styling.",
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
            "Use logger from '@/cli/utils/logger' instead of console for consistent logging. Use printData for JSON output.",
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
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "import/no-unresolved": "off",
    },
  },
  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
]);
