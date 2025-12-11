import * as path from "node:path";
import { loadEnvFile } from "node:process";
import { consola } from "consola";
import { table, getBorderCharacters } from "table";
import type { ParsedArgs } from "citty";

export const commonArgs = {
  "env-file": {
    type: "string",
    description: "Path to the environment file",
    alias: "e",
  },
  verbose: {
    type: "boolean",
    description: "Enable verbose logging",
    alias: "v",
    default: false,
  },
} as const;

export const withCommonArgs =
  <T extends ParsedArgs<typeof commonArgs>>(
    handler: (args: T) => Promise<void>,
  ) =>
  async ({ args }: { args: T }) => {
    try {
      if (args["env-file"] !== undefined) {
        const envPath = path.resolve(process.cwd(), args["env-file"]);
        loadEnvFile(envPath);
      }
      await handler(args);
    } catch (error) {
      if (error instanceof Error) {
        consola.error(error.message);
        if (args.verbose && error.stack) {
          consola.log(`Stack trace:\n${error.stack}`);
        }
      } else {
        consola.error(`Unknown error: ${error}`);
      }
      process.exit(1);
    }
    process.exit(0);
  };

export const jsonArgs = {
  json: {
    type: "boolean",
    description: "Output as JSON",
    default: false,
  },
} as const;

export function parseFormat(jsonFlag: boolean | undefined) {
  return jsonFlag ? ("json" as const) : ("table" as const);
}

export function printWithFormat(
  data: object | object[],
  format: "table" | "json",
) {
  switch (format) {
    case "table": {
      if (Array.isArray(data)) {
        if (data.length === 0) {
          break;
        }

        const headers = Array.from(
          new Set(data.flatMap((item) => Object.keys(item))),
        );

        const rows = data.map((item) =>
          headers.map((header) => {
            const value = (item as Record<string, unknown>)[header];
            if (value === null || value === undefined) {
              return "";
            }
            return String(value);
          }),
        );

        const t = table([headers, ...rows], {
          border: getBorderCharacters("norc"),
          drawHorizontalLine: (lineIndex, rowCount) => {
            // 0: top border, 1: after header row, rowCount: bottom border
            return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
          },
        });
        process.stdout.write(t);
      } else {
        const t = table(Object.entries(data), {
          singleLine: true,
          border: getBorderCharacters("norc"),
        });
        process.stdout.write(t);
      }
      break;
    }
    case "json":
      console.log(JSON.stringify(data));
      break;
    default:
      throw new Error(`Format "${format satisfies never}" is invalid.`);
  }
}
