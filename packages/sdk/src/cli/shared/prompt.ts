import {
  confirm as clackConfirm,
  isCancel,
  text as clackText,
  type ConfirmOptions,
  type TextOptions,
} from "@clack/prompts";
import { isCI } from "std-env";
import { CIPromptError } from "./logger";

/**
 * Prompt the user for confirmation unless running in CI.
 * Cancellation (Ctrl+C) exits the process.
 * @param opts - @clack/prompts ConfirmOptions
 * @throws {CIPromptError} When called in a CI environment
 * @returns true or false
 */
export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  if (isCI) throw new CIPromptError();
  const result = await clackConfirm(opts);
  if (isCancel(result)) process.exit(0);
  return result;
}

/**
 * Prompt the user for text input unless running in CI.
 * Cancellation (Ctrl+C) exits the process.
 * @param opts - @clack/prompts TextOptions
 * @throws {CIPromptError} When called in a CI environment
 * @returns User input string
 */
export async function text(opts: TextOptions): Promise<string> {
  if (isCI) throw new CIPromptError();
  const result = await clackText(opts);
  if (isCancel(result)) process.exit(0);
  return result;
}
