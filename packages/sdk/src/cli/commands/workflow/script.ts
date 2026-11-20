/**
 * `tailor workflow script` command
 *
 * Scaffolds a workflow definition that `tailor workflow run` runs without deploying.
 */

import * as fs from "node:fs";
import { arg } from "@politty/zod";
import * as path from "pathe";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError, formatCommandHint } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { assertGeneratedTypeScript } from "../function/script-scaffold";

const MAIN_JOB_NAME = "process-all";

const WORKFLOW_SKELETON = [
  "/**",
  " * Workflow to try without deploying:",
  " *",
  ` *   tailor workflow run <this file> --job ${MAIN_JOB_NAME} --arg '{"ids":["a","b"]}'`,
  " */",
  "",
  'import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";',
  "",
  "export const processItem = createWorkflowJob({",
  '  name: "process-item",',
  "  body: (input: { id: string }) => {",
  "    return { id: input.id, processed: true };",
  "  },",
  "});",
  "",
  "export const processAll = createWorkflowJob({",
  `  name: "${MAIN_JOB_NAME}",`,
  "  body: (input: { ids: string[] }) => {",
  "    const results = input.ids.map((id) => processItem.start({ id }));",
  "    return { results };",
  "  },",
  "});",
  "",
  "export default createWorkflow({",
  `  name: "${MAIN_JOB_NAME}",`,
  "  mainJob: processAll,",
  "});",
  "",
].join("\n");

export const scriptCommand = defineAppCommand({
  name: "script",
  description: "Scaffold a workflow definition to run with `workflow run`.",
  args: z.strictObject({
    file: arg(z.string(), {
      positional: true,
      description: "Path to create the workflow file at (must end with .ts)",
    }),
  }),
  notes: `The scaffolded file defines two workflow jobs and a workflow: \`process-all\` starts one \`process-item\` job for each id of its input, and the workflow runs from \`process-all\`. Run it with \`tailor workflow run <file> --job process-all --arg '{"ids":["a","b"]}'\`.

Rename the jobs and the workflow and fill in the bodies; to deploy it, add the file to the config's \`workflow.files\`. An existing file is never overwritten.`,
  examples: [{ cmd: "workflows/order.ts", desc: "Scaffold a workflow definition" }],
  run: async (args) => {
    const filePath = path.resolve(args.file);
    if (!filePath.endsWith(".ts")) {
      throw CLIError({
        code: "SCRIPT_PATH_INVALID",
        message: `Workflow path must end with .ts: ${args.file}`,
        command: "workflow script",
      });
    }
    if (fs.existsSync(filePath)) {
      throw CLIError({
        code: "SCRIPT_FILE_EXISTS",
        message: `${args.file} already exists and was left untouched.`,
        suggestion: "Choose a path that does not exist yet.",
        command: "workflow script",
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
        args: ["workflow", "run", relPath, "--job", MAIN_JOB_NAME, "--arg", '{"ids":["a","b"]}'],
      })}`,
    );
  },
});
