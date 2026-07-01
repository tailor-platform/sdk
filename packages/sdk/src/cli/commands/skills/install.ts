import { dirname, resolve } from "pathe";
import { resolvePackageJSON } from "pkg-types";
import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { runSkillsInstaller } from "#/cli/shared/skills-installer";

// Resolve the SDK package root at runtime so the skills directory is found
// regardless of how the file is bundled (tsdown inlines non-entry modules).
// The directory is named `agent-skills` (not `skills`) to avoid `gh skill`'s
// `**/skills/*/SKILL.md` recursive match that would otherwise pick up both
// this bundled copy and the repo-root `skills/` and report a conflict.
export async function resolveBundledSkillsDir(): Promise<string> {
  const pkgJsonPath = await resolvePackageJSON(import.meta.url);
  return resolve(dirname(pkgJsonPath), "agent-skills");
}

const DEFAULT_AGENT = "claude-code";

export const installCommand = defineAppCommand({
  name: "install",
  description: "Install the tailor agent skill from the installed SDK package.",
  args: z.strictObject({
    agent: arg(z.string().default(DEFAULT_AGENT), {
      alias: "a",
      description: `vercel/skills agent name (e.g. ${DEFAULT_AGENT}, codex). Defaults to ${DEFAULT_AGENT}.`,
    }),
    yes: arg(z.boolean().default(false), {
      alias: "y",
      description: "Auto-approve prompts.",
    }),
  }),
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
