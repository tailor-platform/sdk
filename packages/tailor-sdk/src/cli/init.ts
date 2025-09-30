import { defineCommand } from "citty";
import { spawnSync } from "node:child_process";
import { readPackageJSON } from "pkg-types";

const detectPackageManager = () => {
  const availablePMs = ["npm", "yarn", "pnpm"];
  const userAgent = process.env.npm_config_user_agent;
  if (!userAgent) return;
  const [name] = userAgent.split("/");
  if (!availablePMs.includes(name)) return;
  return name;
};

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Initialize a new project using create-tailor-sdk",
  },
  args: {
    name: {
      type: "positional",
      description: "Project name",
      required: false,
    },
    template: {
      type: "string",
      description: "Template name",
      required: false,
    },
  },
  async run({ args }) {
    const packageJson = await readPackageJSON(import.meta.url);
    const version =
      packageJson.version && packageJson.version !== "0.0.0"
        ? packageJson.version
        : "latest";

    let packageManager = detectPackageManager();
    if (!packageManager) {
      console.log("⚠️ Could not detect package manager, defaulting to npm");
      packageManager = "npm";
    }
    const initArgs = [
      "create",
      `@tailor-platform/tailor-sdk@${version}`,
      ...(args.name ? [args.name] : []),
      ...(packageManager === "npm" ? ["--"] : []),
      ...(args.template ? ["--template", args.template] : []),
    ];
    console.log(`Running: ${packageManager} ${initArgs.join(" ")}`);

    spawnSync(packageManager, initArgs, { stdio: "inherit" });
  },
});
