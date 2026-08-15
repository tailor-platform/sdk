import * as v from "valibot";

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const functionSchema: v.GenericSchema<Function, Function> = v.custom<Function>(
  (val) => typeof val === "function",
);
