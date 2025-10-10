import type { ArgsDef, ParsedArgs } from "citty";
import type { CliOption } from "./types";
import type { ApplyOptions } from "@/cli/apply";
import type { GenerateOptions } from "@/cli/generator/options";

type StrictParse<T extends ArgsDef> = {
  [K in keyof ParsedArgs<T> as string extends K
    ? never
    : K extends "_"
      ? never
      : K]: ParsedArgs<T>[K];
};

const commonCommandArgs = {
  config: {
    type: "string",
    description: "Path to the Tailor config file",
    alias: "c",
    default: "tailor.config.ts",
  },
  "env-file": {
    type: "string",
    description: "Path to the environment file",
    alias: "e",
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
} as const satisfies CliOption<Omit<ApplyOptions, "buildOnly">>;

export const commandArgs = {
  apply: cliApplyOption,
  generate: cliGenerateOption,
} as const;

type _ApplyOptions = StrictParse<typeof commandArgs.apply>;
type _GenerateOptions = StrictParse<typeof commandArgs.generate>;

export type CommandArgs =
  | ["apply", _ApplyOptions]
  | ["generate", _GenerateOptions];
