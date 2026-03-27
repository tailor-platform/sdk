import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importPlugin from "eslint-plugin-import-x";
import oxlint from "eslint-plugin-oxlint";

export default defineConfig([
  globalIgnores([
    ".tailor-sdk/",
    "generated/",
    "tests/fixtures/",
    "tests/migration-fixtures/",
    "generated-perf",
    "scripts/perf",
    "seed",
    "migrations",
  ]),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  tseslint.configs.stylisticTypeChecked,
  importPlugin.flatConfigs.recommended,
  {
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
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
    files: ["**/*.ts", "tsdown.config.ts", "vitest.config.ts"],
    rules: {
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
              pattern: "@tailor-platform/**",
              group: "external",
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
  // Disable type-checked linting for root config files.
  // https://typescript-eslint.io/troubleshooting/typed-linting/#how-do-i-disable-type-checked-linting-for-a-file
  {
    files: ["eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "import-x/no-unresolved": "off",
    },
  },
  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
]);
