import type { Exact } from "type-fest";
import type { SqlClient } from "./sql";
import type { TailorType } from "@/configure/types/type";
import type { output } from "@/configure/types/helpers";
import type { TailorUser } from "@/configure/types";
import type { ResolverInput } from "@/parser/service/pipeline/types";

type Context<Input extends TailorType<any, any> | undefined> = {
  input: Input extends TailorType<any, any> ? output<Input> : never;
  user: TailorUser;
  client: SqlClient;
};

export function createResolver<
  Input extends TailorType<any, any> | undefined = undefined,
  Output extends TailorType<any, any> = TailorType<any, any>,
  Return extends Exact<output<Output>, Return> = any,
>(
  config: Omit<ResolverInput, "input" | "output" | "body"> &
    Readonly<{
      input?: Input;
      output: Output;
      body: (context: Context<Input>) => Return | Promise<Return>;
    }>,
) {
  return config;
}

export type ResolverConfig = ReturnType<
  typeof createResolver<
    TailorType<any, any> | undefined,
    TailorType<any, any>,
    unknown
  >
>;
