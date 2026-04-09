import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import oxlint from "eslint-plugin-oxlint";

export default defineConfig([
  globalIgnores([".tailor-sdk/", "src/generated/"]),
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
  {
    files: ["eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
]);
