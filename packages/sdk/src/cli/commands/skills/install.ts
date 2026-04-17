import { dirname, resolve } from "pathe";
import { resolvePackageJSON } from "pkg-types";
import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { runSkillsInstaller } from "@/cli/shared/skills-installer";

// Resolve the SDK package root at runtime so the skills directory is found
// regardless of how the file is bundled (tsdown inlines non-entry modules).
export async function resolveBundledSkillsDir(): Promise<string> {
  const pkgJsonPath = await resolvePackageJSON(import.meta.url);
  return resolve(dirname(pkgJsonPath), "skills");
}

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
      source: await resolveBundledSkillsDir(),
      agent: args.agent,
      yes: args.yes,
    });
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  },
});
