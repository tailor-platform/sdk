import * as v from "valibot";

export const workspaceNameSchema = v.pipe(
  v.string(),
  v.minLength(3, "Name must be at least 3 characters"),
  v.maxLength(63, "Name must be at most 63 characters"),
  v.regex(/^[a-z0-9-]+$/, "Name can only contain lowercase letters, numbers, and hyphens"),
  v.check(
    (name) => !name.startsWith("-") && !name.endsWith("-"),
    "Name cannot start or end with a hyphen",
  ),
);

/**
 * Validate a workspace name for use in an interactive prompt.
 * @param name - Candidate workspace name
 * @returns True when valid, otherwise a validation message
 */
export function validateWorkspaceName(name: string): true | string {
  const result = v.safeParse(workspaceNameSchema, name);
  return result.success ? true : result.issues[0].message;
}
