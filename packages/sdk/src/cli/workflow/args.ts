import { arg } from "politty";
import { z } from "zod";

export const nameArgs = {
  name: arg(z.string(), {
    positional: true,
    description: "Workflow name",
  }),
};

export const waitArgs = {
  wait: arg(z.boolean().default(false), {
    alias: "W",
    description: "Wait for execution to complete",
  }),
  interval: arg(z.string().default("3s"), {
    alias: "i",
    description: "Polling interval when using --wait",
  }),
  logs: arg(z.boolean().default(false), {
    alias: "l",
    description: "Display job execution logs after completion (requires --wait)",
  }),
};
