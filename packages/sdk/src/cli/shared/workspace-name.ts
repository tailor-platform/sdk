import { z } from "zod";
import { assertDefined } from "#/utils/assert";

export const workspaceNameSchema = z
  .string()
  .min(3, "Name must be at least 3 characters")
  .max(63, "Name must be at most 63 characters")
  .regex(/^[a-z0-9-]+$/, "Name can only contain lowercase letters, numbers, and hyphens")
  .refine(
    (name) => !name.startsWith("-") && !name.endsWith("-"),
    "Name cannot start or end with a hyphen",
  );

/**
 * Validate a workspace name for use in an interactive prompt.
 * @param name - Candidate workspace name
 * @returns True when valid, otherwise a validation message
 */
export function validateWorkspaceName(name: string): true | string {
  const result = workspaceNameSchema.safeParse(name);
  return result.success
    ? true
    : assertDefined(result.error.issues[0], "Zod returned no issues").message;
}
