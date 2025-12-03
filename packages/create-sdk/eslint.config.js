import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import importPlugin from "eslint-plugin-import";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // Ignore build and template directories.
  // Each template has its own ESLint config and should be linted separately.
  globalIgnores(["dist/", "templates/"]),
  // Use recommended rules.
  // https://typescript-eslint.io/users/configs#projects-with-type-checking
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Disable type-checked linting for root config files.
  // https://typescript-eslint.io/troubleshooting/typed-linting/#how-do-i-disable-type-checked-linting-for-a-file
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    rules: {
      "import/no-unresolved": "off",
      "import/order": [
        "error",
        {
          alphabetize: {
            order: "asc",
          },
        },
      ],
    },
  },
]);
