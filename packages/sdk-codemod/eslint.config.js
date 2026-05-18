import eslint from "@eslint/js";
import oxlint from "eslint-plugin-oxlint";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/", "codemods/"]),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  ...oxlint.configs["flat/recommended"],
]);
