import { arg } from "@politty/valibot";
import * as v from "valibot";
import { durationArg } from "#/cli/shared/args";
import type { WorkflowWaitUntil } from "./status";

type ArgsShape = Record<string, v.GenericSchema>;

export const workflowWaitUntilArg = v.picklist([
  "success",
  "suspended",
  "terminal",
]) satisfies v.GenericSchema<WorkflowWaitUntil>;

export const nameArgs = {
  name: arg(v.string(), {
    positional: true,
    description: "Workflow name",
  }),
} satisfies ArgsShape;

export const workflowWaitControlArgs = {
  interval: arg(v.optional(durationArg, "3s"), {
    alias: "i",
    description: "Polling interval when waiting (e.g., '3s', '500ms', '1m')",
  }),
  timeout: arg(v.optional(durationArg, "10m"), {
    alias: "t",
    description: "Maximum time to wait (e.g., '30s', '10m')",
  }),
  until: arg(v.optional(workflowWaitUntilArg, "terminal"), {
    alias: "u",
    description: "Wait target (success, suspended, terminal)",
  }),
  logs: arg(v.optional(v.boolean(), false), {
    alias: "l",
    description: "Display job execution logs after completion",
  }),
} satisfies ArgsShape;

export const waitArgs = {
  wait: arg(v.optional(v.boolean(), false), {
    alias: "W",
    description: "Wait for execution to complete",
  }),
  ...workflowWaitControlArgs,
} satisfies ArgsShape;
