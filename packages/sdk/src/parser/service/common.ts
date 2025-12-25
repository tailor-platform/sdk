import { z } from "zod";

// Use `z.custom` instead of `z.function`, since `z.function` changes `toString` representation.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const functionSchema = z.custom<Function>((val) => typeof val === "function");
