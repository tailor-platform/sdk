import { ExitPromptError } from "@inquirer/core";
import { confirm, input, password, select } from "@inquirer/prompts";
import { isCI } from "std-env";
import { CIPromptError, logger } from "./logger";

export function canPrompt(): boolean {
  return !isCI && process.stdin.isTTY === true && process.stdout.isTTY === true && !logger.jsonMode;
}

/**
 * Wraps a prompt function with CI guard and cancellation handling.
 * @param fn - A prompt function from `@inquirer/prompts`
 * @param unavailableMessage - Message used when interactive input is unavailable
 * @returns A wrapped function that throws in CI and exits on cancel
 */
function withGuard<Config, R>(
  fn: (config: Config) => Promise<R>,
  unavailableMessage?: string,
): (config: Config) => Promise<R> {
  return async (config: Config): Promise<R> => {
    if (!canPrompt()) throw new CIPromptError(unavailableMessage);
    try {
      return await fn(config);
    } catch (error) {
      if (error instanceof ExitPromptError) process.exit(130);
      throw error;
    }
  };
}

/** Options accepted by {@link prompt.confirm}. */
export interface ConfirmConfig {
  message: string;
  default?: boolean;
}

/** Options accepted by {@link prompt.text}. */
export interface TextConfig {
  message: string;
  default?: string;
  required?: boolean;
  validate?: (value: string) => boolean | string | Promise<boolean | string>;
}

/** Options accepted by {@link prompt.password}. */
export interface PasswordConfig {
  message: string;
  mask?: boolean | string;
  validate?: (value: string) => boolean | string | Promise<boolean | string>;
}

/** A selectable entry of {@link SelectConfig.choices}. */
export interface SelectChoice<Value> {
  value: Value;
  name?: string;
  description?: string;
  short?: string;
  disabled?: boolean | string;
}

/** Options accepted by {@link prompt.select}. */
export interface SelectConfig<Value> {
  message: string;
  choices: readonly SelectChoice<Value>[];
  default?: NoInfer<Value>;
  pageSize?: number;
  loop?: boolean;
}

/**
 * Interactive prompts that fail with an actionable message instead of hanging
 * when stdin is not a TTY (CI, piped input), and exit with 130 on Ctrl-C.
 *
 * The config types are declared here rather than inferred from
 * `@inquirer/prompts`: inference pulls `@inquirer/*` internals (`Context`,
 * `Keybinding`, `PartialDeep`) into this public type, and those cannot be
 * named portably from the published declarations (TS2883). They cover the
 * options this CLI uses — widen them here when a call site needs more.
 */
export const prompt = {
  confirm: withGuard<ConfirmConfig, boolean>(
    confirm,
    "Interactive confirmations are not available in this environment. Use --yes to skip confirmation prompts, or provide the required options explicitly.",
  ),
  text: withGuard<TextConfig, string>(input),
  password: withGuard<PasswordConfig, string>(password),
  select: <const Value>(config: SelectConfig<Value>): Promise<Value> =>
    withGuard<SelectConfig<Value>, Value>(select)(config),
};
