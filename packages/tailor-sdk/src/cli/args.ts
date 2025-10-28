import * as path from "node:path";
import { loadEnvFile } from "node:process";

import type { ParsedArgs } from "citty";
import { consola } from "consola";

export const commonArgs = {
  "env-file": {
    type: "string",
    description: "Path to the environment file",
    alias: "e",
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
      } else {
        consola.error(`Unknown error: ${error}`);
      }
      process.exit(1);
    }
  };
