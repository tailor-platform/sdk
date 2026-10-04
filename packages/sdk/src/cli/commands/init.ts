import { spawnSync } from "node:child_process";
import { arg } from "@politty/zod";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { readPackageJson } from "#/cli/shared/package-json";

const detectPackageManager = () => {
  const availablePMs = ["npm", "yarn", "pnpm", "bun"];
  const userAgent = process.env.npm_config_user_agent;
  if (!userAgent) return;
  const [name] = userAgent.split("/") as [string, ...string[]];
  if (!availablePMs.includes(name)) return;
  return name;
};

export const initCommand = defineAppCommand({
  name: "init",
  description: "Initialize a new project using create-sdk.",
  args: z.strictObject({
    name: arg(z.string().optional(), {
      positional: true,
      description: "Project name",
    }),
    template: arg(z.string().optional(), {
      alias: "t",
      description: "Template name",
    }),
  }),
  run: async (args) => {
    const packageJson = await readPackageJson();
    const version =
      packageJson.version && packageJson.version !== "0.0.0" ? packageJson.version : "latest";

    let packageManager = detectPackageManager();
    if (!packageManager) {
      logger.warn("Could not detect package manager, defaulting to npm");
      packageManager = "npm";
    }
    const initArgs = [
      "create",
      `@tailor-platform/sdk@${version}`,
      ...(args.name ? [args.name] : []),
      ...(packageManager === "npm" ? ["--"] : []),
      ...(args.template ? ["--template", args.template] : []),
    ];
    logger.log(`Running: ${packageManager} ${initArgs.join(" ")}`);

    const result = spawnSync(packageManager, initArgs, { stdio: "inherit" });
    const context = { command: packageManager, args: initArgs };
    if (result.error) {
      throw CLIError({
        code: "INIT_SPAWN_FAILED",
        message: `Failed to run ${packageManager}: ${result.error.message}`,
        suggestion: `Check that ${packageManager} is installed and executable.`,
        command: "init",
        context,
        cause: result.error,
      });
    }
    if (result.status !== 0) {
      throw CLIError({
        code: "INIT_FAILED",
        message:
          result.signal === null
            ? `${packageManager} create exited with code ${result.status}.`
            : `${packageManager} create was terminated by ${result.signal}.`,
        command: "init",
        context: {
          ...context,
          exitCode: result.status ?? undefined,
          signal: result.signal ?? undefined,
        },
      });
    }
  },
});
