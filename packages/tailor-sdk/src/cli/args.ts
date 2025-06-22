import type { ParsedArgs } from "citty";

export const commonCommandArgs = {
  config: {
    type: "string",
    description: "Path to the Tailor config file",
    alias: "c",
  },
} as const;

export const applyCommandArgs = {
  ...commonCommandArgs,
  dryRun: {
    type: "boolean",
    description: "Run the command without making any changes",
    alias: "d",
  },
} as const;

export const generateCommandArgs = commonCommandArgs;

export type CommandArgs =
  | ["apply", ParsedArgs<typeof applyCommandArgs>]
  | ["generate", ParsedArgs<typeof generateCommandArgs>];

export type ApplyOptions = Omit<ParsedArgs<typeof applyCommandArgs>, "config">;
export type GenerateOptions = Omit<
  ParsedArgs<typeof generateCommandArgs>,
  "config"
>;
