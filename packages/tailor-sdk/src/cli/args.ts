import * as path from "node:path";
import { loadEnvFile } from "node:process";
import { consola } from "consola";
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
  };
