import { resolve } from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { runSkillsInstaller } from "@/cli/shared/skills-installer";

// dist/cli/commands/skills/install.mjs -> ../../../.. = {sdk_package_root}/skills
const bundledSkillsDir = resolve(import.meta.dirname, "..", "..", "..", "..", "skills");

export const installCommand = defineAppCommand({
  name: "install",
  description: "Install the tailor-sdk agent skill from the installed SDK package.",
  args: z
    .object({
      agent: arg(z.string().optional(), {
        alias: "a",
        description: "Target agent (claude, codex). Defaults to claude.",
      }),
      yes: arg(z.boolean().default(false), {
        alias: "y",
        description: "Auto-approve prompts.",
      }),
    })
    .strict(),
  run: async (args) => {
    const exitCode = await runSkillsInstaller({
      source: bundledSkillsDir,
      agent: args.agent,
      yes: args.yes,
    });
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  },
});
