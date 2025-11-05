import type { TailorUser } from "@/configure/types";
import type { InferFieldsOutput } from "@/configure/types/helpers";
import type { TailorField } from "@/configure/types/type";
import type { ResolverInput } from "@/parser/service/resolver/types";

type Context<Input extends Record<string, TailorField<any>> | undefined> = {
  input: Input extends Record<string, TailorField<any>>
    ? InferFieldsOutput<Input>
    : never;
  user: TailorUser;
};

export function createResolver<
  Input extends Record<string, TailorField<any>> | undefined = undefined,
  Output extends TailorField<any> = TailorField<any>,
>(
  config: Omit<ResolverInput, "input" | "output" | "body"> &
    Readonly<{
      input?: Input;
      output: Output;
      body: (
        context: Context<Input>,
      ) => Output["_output"] | Promise<Output["_output"]>;
    }>,
) {
  return config;
}

export type ResolverConfig = ReturnType<typeof createResolver<any, any>>;
