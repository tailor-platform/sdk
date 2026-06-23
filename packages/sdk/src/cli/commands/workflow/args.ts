import { arg } from "politty";
import { z } from "zod";
import { durationArg } from "@/cli/shared/args";
import type { WorkflowWaitUntil } from "./status";

type ArgsShape = Record<string, z.ZodType>;

export const workflowWaitUntilArg = z.enum([
  "success",
  "suspended",
  "terminal",
]) satisfies z.ZodType<WorkflowWaitUntil>;

export const nameArgs = {
  name: arg(z.string(), {
    positional: true,
    description: "Workflow name",
  }),
} satisfies ArgsShape;

export const workflowWaitControlArgs = {
  interval: arg(durationArg.default("3s"), {
    alias: "i",
    description: "Polling interval when waiting (e.g., '3s', '500ms', '1m')",
  }),
  timeout: arg(durationArg.default("10m"), {
    alias: "t",
    description: "Maximum time to wait (e.g., '30s', '10m')",
  }),
  until: arg(workflowWaitUntilArg.default("terminal"), {
    alias: "u",
    description: "Wait target (success, suspended, terminal)",
  }),
  logs: arg(z.boolean().default(false), {
    alias: "l",
    description: "Display job execution logs after completion",
  }),
} satisfies ArgsShape;

export const waitArgs = {
  wait: arg(z.boolean().default(false), {
    alias: "W",
    description: "Wait for execution to complete",
  }),
  ...workflowWaitControlArgs,
} satisfies ArgsShape;
