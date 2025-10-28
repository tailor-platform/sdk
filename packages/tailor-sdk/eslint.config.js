import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/"]),
  eslint.configs.recommended,
  tseslint.configs.recommended,
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
              message:
                "Configure module can import only types from zod module.",
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
  },
]);
