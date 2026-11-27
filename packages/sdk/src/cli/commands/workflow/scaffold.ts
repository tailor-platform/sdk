/**
 * `tailor workflow scaffold` command
 *
 * Scaffolds a workflow definition that `tailor workflow run` runs without deploying.
 */

import * as fs from "node:fs";
import { arg } from "@politty/zod";
import * as path from "pathe";
import { z } from "zod";
import { recoveryContextArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError, formatCommandHint } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { assertGeneratedTypeScript } from "../function/script-scaffold";

const MAIN_JOB_NAME = "main";

const WORKFLOW_SKELETON = [
  "/**",
  " * Workflow to try without deploying:",
  " *",
  ` *   tailor workflow run <this file> --arg '{"ids":["a","b"]}'`,
  " */",
  "",
  'import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";',
  "",
  "export const sub = createWorkflowJob({",
  '  name: "sub",',
  "  body: (input: { id: string }) => {",
  "    return { id: input.id, processed: true };",
  "  },",
  "});",
  "",
  "export const main = createWorkflowJob({",
  `  name: "${MAIN_JOB_NAME}",`,
  "  body: (input: { ids: string[] }) => {",
  "    const results = input.ids.map((id) => sub.start({ id }));",
  "    return { results };",
  "  },",
  "});",
  "",
  "export default createWorkflow({",
  '  name: "temporal-workflow",',
  "  mainJob: main,",
  "});",
  "",
].join("\n");

export const scaffoldCommand = defineAppCommand({
  name: "scaffold",
  description: "Scaffold a workflow definition to run with `workflow run`.",
  args: z.strictObject({
    file: arg(z.string(), {
      positional: true,
      description: "Path to create the workflow file at (must end with .ts)",
    }),
  }),
  notes: `The scaffolded file defines two workflow jobs and a workflow: \`main\` starts one \`sub\` job for each id of its input, and the workflow runs from \`main\`. Run it with \`tailor workflow run <file> --arg '{"ids":["a","b"]}'\`.

Rename the jobs and the workflow and fill in the bodies; to deploy it, add the file to the config's \`workflow.files\`. An existing file is never overwritten.`,
  examples: [{ cmd: "workflows/order.ts", desc: "Scaffold a workflow definition" }],
  run: async (args) => {
    const filePath = path.resolve(args.file);
    if (!filePath.endsWith(".ts")) {
      throw CLIError({
        code: "SCAFFOLD_PATH_INVALID",
        message: `Workflow path must end with .ts: ${args.file}`,
        command: "workflow scaffold",
      });
    }
    if (fs.existsSync(filePath)) {
      throw CLIError({
        code: "SCAFFOLD_FILE_EXISTS",
        message: `${args.file} already exists and was left untouched.`,
        suggestion: "Choose a path that does not exist yet.",
        command: "workflow scaffold",
      });
    }
    assertGeneratedTypeScript(filePath, WORKFLOW_SKELETON);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, WORKFLOW_SKELETON);

    const relPath = path.relative(process.cwd(), filePath);
    logger.success(`Created ${styles.path(relPath)}`);
    logger.info(
      `Next: edit the workflow, then run ${formatCommandHint({
        command: "tailor",
        args: [
          "workflow",
          "run",
          relPath,
          "--arg",
          '{"ids":["a","b"]}',
          ...recoveryContextArgs({}),
        ],
      })}`,
    );
  },
});
