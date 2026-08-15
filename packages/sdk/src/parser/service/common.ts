import * as v from "valibot";

// Not `v.function()`: its input and output are `(...args: unknown[]) => unknown`, which no
// user-written handler is assignable to under strictFunctionTypes. `v.custom<Function>` keeps
// `Function` on both sides, which is what the vinfer-generated types hand back to users.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const functionSchema: v.GenericSchema<Function, Function> = v.custom<Function>(
  (val) => typeof val === "function",
  "Expected a function",
);
