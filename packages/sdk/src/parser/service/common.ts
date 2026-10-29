import { z } from "zod";

// Use `z.custom` instead of `z.function`, since `z.function` changes `toString` representation.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const functionSchema: z.ZodType<Function, Function> = z.custom<Function>(
  (val) => typeof val === "function",
);

export const resourceNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
    "must be 3-63 lowercase letters, digits, or hyphens, starting and ending with a letter or digit",
  );
