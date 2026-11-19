/**
 * `tailor workflow script` command
 *
 * Scaffolds a script that `tailor workflow run` executes past the
 * synchronous time limit.
 */

import { defineAppCommand } from "#/cli/shared/command";
import { scaffoldScript, scriptArgs } from "../function/script";
import { generateWorkflowScriptSkeleton } from "../function/script-scaffold";

export const scriptCommand = defineAppCommand({
  name: "script",
  description: "Scaffold a long-running script to run with `workflow run`.",
  args: scriptArgs,
  notes: `The scaffolded script is a default-exported \`main(arg)\` function; execute it with \`tailor workflow run <file>\`. \`workflow run\` passes \`--arg\` to \`main\` as its argument and prints what \`main\` returns.

The Platform ends a workflow job that runs too long, so the skeleton handles a bounded batch of rows per run: it stops before the limit and returns where it stopped (\`{ done: false, next: { after } }\`). Run it again with \`--arg '{"after":"…"}'\` to continue from there, until it returns \`{ done: true }\`.

Database types are generated the same way as in \`function script\`: the skeleton imports \`getDB()\` from the \`kyselyTypePlugin\` types when the project configures the plugin, and otherwise writes a script-scoped \`db.ts\` plus a \`db.snapshot.json\` next to the script. \`workflow run\` refuses to run the script when that snapshot no longer matches the table and field structure; pass \`--allow-schema-drift\` to run it anyway. Pass \`--remote\` to generate them from the deployed schema. Re-running the command refreshes \`db.ts\` and \`db.snapshot.json\` and leaves the script itself untouched.`,
  examples: [
    {
      cmd: "scripts/backfill.ts",
      desc: "Scaffold a long-running script (single-namespace project)",
    },
    {
      cmd: "scripts/backfill.ts --namespace tailordb",
      desc: "Scaffold a script targeting a specific namespace",
    },
  ],
  run: async (args) =>
    scaffoldScript(args, {
      command: "workflow script",
      runCommand: ["workflow", "run"],
      skeleton: generateWorkflowScriptSkeleton,
    }),
});
