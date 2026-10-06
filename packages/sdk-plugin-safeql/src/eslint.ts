import { rules } from "@ts-safeql/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import tailorPglite from "./pglite-connection";
import type { ESLint, Linter } from "eslint";

/** Options for {@link tailorSafeqlConfig}. */
export interface TailorSafeqlConfigOptions {
  /** The `CREATE TABLE` script SafeQL checks statements against. */
  ddl: string;
  /** Column types SafeQL cannot infer from the script, keyed `"<table>.<column>"`. */
  overrides?: { columns?: Record<string, string> };
  /** Files to check. Defaults to every `.ts` file. */
  files?: string[];
}

/**
 * An ESLint flat config that checks `sql` tagged statements with SafeQL against the given schema.
 * @param options - The schema, column types, and files to check
 * @returns Flat config entries to spread into `eslint.config.ts`
 */
export function tailorSafeqlConfig(options: TailorSafeqlConfigOptions): Linter.Config[] {
  return [
    {
      files: options.files ?? ["**/*.ts"],
      languageOptions: { parser: tsParser, parserOptions: { projectService: true } },
      plugins: { "@ts-safeql": { rules: rules as unknown as ESLint.Plugin["rules"] } },
      rules: {
        "@ts-safeql/check-sql": [
          "error",
          {
            connections: [
              {
                plugins: [tailorPglite({ ddl: options.ddl })],
                overrides: { columns: options.overrides?.columns },
                targets: [{ tag: "sql" }],
              },
            ],
          },
        ],
      },
    },
  ];
}
