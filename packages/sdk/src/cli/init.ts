import { spawnSync } from "node:child_process";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs } from "./args";
import { logger } from "./utils/logger";
import { readPackageJson } from "./utils/package-json";

const detectPackageManager = () => {
  const availablePMs = ["npm", "yarn", "pnpm"];
  const userAgent = process.env.npm_config_user_agent;
  if (!userAgent) return;
  const [name] = userAgent.split("/");
  if (!availablePMs.includes(name)) return;
  return name;
};

export const initCommand = defineCommand({
  name: "init",
  description: "Initialize a new project using create-sdk",
  args: z.object({
    ...commonArgs,
    name: arg(z.string().optional(), {
      positional: true,
      description: "Project name",
    }),
    template: arg(z.string().optional(), {
      alias: "t",
      description: "Template name",
    }),
  }),
  run: withCommonArgs(async (args) => {
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

    spawnSync(packageManager, initArgs, { stdio: "inherit" });
  }),
});
