import { arg } from "politty";
import { z } from "zod";
import { durationArg } from "#src/cli/shared/args";

type ArgsShape = Record<string, z.ZodType>;

export const nameArgs = {
  name: arg(z.string(), {
    positional: true,
    description: "Workflow name",
  }),
} satisfies ArgsShape;

export const waitArgs = {
  wait: arg(z.boolean().default(false), {
    alias: "W",
    description: "Wait for execution to complete",
  }),
  interval: arg(durationArg.default("3s"), {
    alias: "i",
    description: "Polling interval when using --wait (e.g., '3s', '500ms', '1m')",
  }),
  logs: arg(z.boolean().default(false), {
    alias: "l",
    description: "Display job execution logs after completion (requires --wait)",
  }),
} satisfies ArgsShape;
