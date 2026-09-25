import type { z } from "zod";

export function formatIssues(issues: z.ZodError["issues"]): string {
  return issues.map((issue) => issue.message).join("; ") || "Invalid options";
}

export function parseOptions<Schema extends z.ZodType>(
  schema: Schema,
  options: z.input<Schema>,
): z.output<Schema> {
  const result = schema.safeParse(options);
  if (!result.success) {
    throw new Error(formatIssues(result.error.issues));
  }
  return result.data;
}
