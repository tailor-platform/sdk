import type { Exact } from "type-fest";
import type { SqlClient } from "./sql";
import type { TailorType } from "@/configure/types/type";
import type { output } from "@/configure/types/helpers";
import type { TailorUser } from "@/configure/types";
import type { ResolverInput } from "@/parser/service/pipeline/types";

type Context<Input extends TailorType<any, any> | undefined> =
  Input extends TailorType<any, any>
    ? { input: output<Input>; user: TailorUser; client: SqlClient }
    : { user: TailorUser; client: SqlClient };

export function createResolver<
  Input extends TailorType<any, any> | undefined,
  Output extends TailorType<any, any>,
  Return extends Exact<output<Output>, Return>,
>(
  config: ResolverInput &
    Readonly<{
      input?: Input;
      output: Output;
      body: (context: Context<Input>) => Return | Promise<Return>;
    }>,
) {
  return config;
}
