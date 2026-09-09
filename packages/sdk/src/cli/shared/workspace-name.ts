import { z } from "zod";
import { formatIssues } from "#/cli/shared/parse-options";

const WORKSPACE_NAME_MIN_LENGTH = 3;
const WORKSPACE_NAME_MAX_LENGTH = 63;
const WORKSPACE_NAME_ALLOWED_CHARS_DESCRIPTION = "lowercase letters, numbers, and hyphens";
const WORKSPACE_NAME_NO_LEADING_TRAILING_HYPHEN_DESCRIPTION = "cannot start or end with a hyphen";

/**
 * Validates a workspace name against the platform's naming rules: 3-63
 * lowercase alphanumeric or hyphen characters, not starting or ending with a
 * hyphen.
 */
export const workspaceNameSchema = z
  .string()
  .min(WORKSPACE_NAME_MIN_LENGTH, `Name must be at least ${WORKSPACE_NAME_MIN_LENGTH} characters`)
  .max(WORKSPACE_NAME_MAX_LENGTH, `Name must be at most ${WORKSPACE_NAME_MAX_LENGTH} characters`)
  .regex(/^[a-z0-9-]+$/, `Name can only contain ${WORKSPACE_NAME_ALLOWED_CHARS_DESCRIPTION}`)
  .refine(
    (name) => !name.startsWith("-") && !name.endsWith("-"),
    `Name ${WORKSPACE_NAME_NO_LEADING_TRAILING_HYPHEN_DESCRIPTION}`,
  );

/**
 * Validate a workspace name for use in an interactive prompt.
 * @param name - Candidate workspace name
 * @returns True when valid, otherwise a validation message
 */
export function validateWorkspaceName(name: string): true | string {
  const result = workspaceNameSchema.safeParse(name);
  return result.success ? true : formatIssues(result.error.issues);
}
