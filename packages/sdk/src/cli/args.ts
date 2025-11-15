import * as path from "node:path";
import { loadEnvFile } from "node:process";
import { consola } from "consola";
import { table } from "table";
import { z } from "zod";
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

const formatSchema = z.enum(["table", "json"]);

export const formatArgs = {
  format: {
    type: "string",
    description: `Output format (${formatSchema.options.join(", ")})`,
    alias: "f",
    default: "table",
  },
} as const;

export function parseFormat(format: string) {
  const parsed = formatSchema.safeParse(format);
  if (!parsed.success) {
    throw new Error(
      `Format "${format}" is invalid. Must be one of: ${formatSchema.options.join(", ")}`,
    );
  }
  return parsed.data;
}

export function printWithFormat(
  data: object | object[],
  format: z.output<typeof formatSchema>,
) {
  switch (format) {
    case "table": {
      if (Array.isArray(data)) {
        data.forEach((item) => {
          const t = table(Object.entries(item), {
            singleLine: true,
          });
          process.stdout.write(t);
        });
      } else {
        const t = table(Object.entries(data), {
          singleLine: true,
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
