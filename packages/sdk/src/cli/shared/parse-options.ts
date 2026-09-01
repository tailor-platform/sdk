import { assertDefined } from "#/utils/assert";
import type { z } from "zod";

export function parseOptions<Schema extends z.ZodType>(
  schema: Schema,
  options: z.input<Schema>,
  missingIssueMessage = "Zod returned no issues",
): z.output<Schema> {
  const result = schema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], missingIssueMessage).message);
  }
  return result.data;
}
