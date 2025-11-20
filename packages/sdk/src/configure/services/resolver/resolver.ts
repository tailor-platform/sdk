import { t, TailorField } from "@/configure/types/type";
import type { TailorUser } from "@/configure/types";
import type { TailorEnv } from "@/configure/types/env";
import type { InferFieldsOutput, output } from "@/configure/types/helpers";
import type { ResolverInput } from "@/parser/service/resolver/types";

type Context<
  Input extends Record<string, TailorField<any>> | undefined
> = {
  input: Input extends Record<string, TailorField<any>>
    ? InferFieldsOutput<Input>
    : never;
  user: TailorUser;
  env: TailorEnv;
};

type OutputType<O> =
  O extends TailorField<any>
    ? output<O>
    : O extends Record<string, TailorField<any>>
      ? InferFieldsOutput<O>
      : never;

export function createResolver<
  Input extends Record<string, TailorField<any>> | undefined = undefined,
  Output extends
    | TailorField<any>
    | Record<string, TailorField<any>> = TailorField<any>,
>(
  config: Omit<ResolverInput, "input" | "output" | "body"> &
    Readonly<{
      input?: Input;
      output: Output;
      body: (
        context: Context<Input>,
      ) => OutputType<Output> | Promise<OutputType<Output>>;
    }>,
) {
  const normalizedOutput =
    config.output instanceof TailorField
      ? config.output
      : t.object(config.output);

  return {
    ...config,
    output: normalizedOutput,
  };
}

export type ResolverConfig = ReturnType<typeof createResolver<any, any>>;
