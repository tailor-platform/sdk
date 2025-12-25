export const nameArgs = {
  name: {
    type: "positional",
    description: "Workflow name",
    required: true,
  },
} as const;

export const waitArgs = {
  wait: {
    type: "boolean",
    alias: "W",
    description: "Wait for execution to complete",
    default: false,
  },
  interval: {
    type: "string",
    description: "Polling interval when using --wait",
    alias: "i",
    default: "3s",
  },
  logs: {
    type: "boolean",
    alias: "l",
    description: "Display job execution logs after completion (requires --wait)",
    default: false,
  },
} as const;
