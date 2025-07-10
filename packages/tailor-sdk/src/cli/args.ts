import type { ArgsDef, ParsedArgs } from "citty";
import type { CliOption } from "./types";
import type { GenerateOptions, ApplyOptions } from "@/generator/options";

type StrictParse<T extends ArgsDef> = {
  [K in keyof ParsedArgs<T> as string extends K
    ? never
    : K extends "_"
      ? never
      : K]: ParsedArgs<T>[K];
};

export const commonCommandArgs = {
  config: {
    type: "string",
    description: "Path to the Tailor config file",
    alias: "c",
    default: "tailor.config.ts",
  },
} as const;

const cliGenerateOption = {
  ...commonCommandArgs,
  watch: {
    type: "boolean",
    description: "Watch for type/resolver changes and regenerate",
    alias: "w",
  },
} as const satisfies CliOption<GenerateOptions>;

const cliApplyOption = {
  ...commonCommandArgs,
  dryRun: {
    type: "boolean",
    description: "Run the command without making any changes",
    alias: "d",
  },
} as const satisfies CliOption<ApplyOptions>;

export const commandArgs = {
  apply: cliApplyOption,
  generate: cliGenerateOption,
} as const;

export type _ApplyOptions = StrictParse<typeof commandArgs.apply>;
export type _GenerateOptions = StrictParse<typeof commandArgs.generate>;

export type CommandArgs =
  | ["apply", _ApplyOptions]
  | ["generate", _GenerateOptions];

export { type ApplyOptions, type GenerateOptions } from "@/generator/options";
