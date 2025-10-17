import { type SqlClient } from "./sql";
import { type TailorType } from "@/configure/types/type";
import { type output } from "@/configure/types/helpers";
import type { TailorUser } from "@/configure/types";
import type { Resolver, ResolverInput } from "@/parser/service/pipeline/types";

type Context<Input extends TailorType<any, any> | undefined> =
  Input extends TailorType<any, any>
    ? { input: output<Input>; user: TailorUser; client: SqlClient }
    : { user: TailorUser; client: SqlClient };

type CreateResolver<
  Input extends TailorType<any, any> | undefined,
  Output extends TailorType<any, any>,
> = ResolverInput &
  Readonly<{
    input?: Input;
    output: Output;
    body: (context: Context<Input>) => output<Output> | Promise<output<Output>>;
  }>;

export function createResolver<
  const Input extends TailorType<any, any> | undefined,
  const Output extends TailorType<any, any>,
>(config: CreateResolver<Input, Output>) {
  return config as Resolver & {
    readonly body: (
      context: Context<Input>,
    ) => output<Output> | Promise<output<Output>>;
    readonly output: Output;
  };
}
