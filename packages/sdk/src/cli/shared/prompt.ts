// eslint-disable-next-line no-restricted-imports -- this module is the wrapper the rule points to
import { ExitPromptError } from "@inquirer/core";
// eslint-disable-next-line no-restricted-imports -- this module is the wrapper the rule points to
import { confirm, input, password, select } from "@inquirer/prompts";
import { withErrorDiagnostics } from "./error-diagnostics";
import { CIPromptError, interactiveTerminal, logger } from "./logger";

export function canPrompt(): boolean {
  return interactiveTerminal() && !logger.jsonMode;
}

/**
 * Wraps a prompt function with CI guard and cancellation handling.
 * @param fn - A prompt function from `@inquirer/prompts`
 * @param unavailableMessage - Message used when interactive input is unavailable
 * @returns A wrapped function that throws in CI and exits on cancel
 */
function withGuard<Config extends BasePromptConfig, R>(
  fn: (config: Omit<Config, "suggestion">) => Promise<R>,
  unavailableMessage?: string,
): (config: Config) => Promise<R> {
  return async (promptConfig: Config): Promise<R> => {
    const { suggestion, ...config } = promptConfig;
    if (!canPrompt()) {
      const error = new CIPromptError(unavailableMessage);
      throw suggestion === undefined ? error : withErrorDiagnostics(error, { suggestion });
    }
    try {
      return await fn(config);
    } catch (error) {
      if (error instanceof ExitPromptError) process.exit(130);
      throw error;
    }
  };
}

/** Options every prompt accepts. */
export interface BasePromptConfig {
  /** Remediation reported when the prompt cannot be shown, such as the option or environment variable that supplies the answer instead. */
  suggestion?: string;
}

/** Options accepted by {@link prompt.confirm}. */
export interface ConfirmConfig extends BasePromptConfig {
  message: string;
  default?: boolean;
}

/** Options accepted by {@link prompt.text}. */
export interface TextConfig extends BasePromptConfig {
  message: string;
  default?: string;
  required?: boolean;
  validate?: (value: string) => boolean | string | Promise<boolean | string>;
}

/** Options accepted by {@link prompt.password}. */
export interface PasswordConfig extends BasePromptConfig {
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
export interface SelectConfig<Value> extends BasePromptConfig {
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
