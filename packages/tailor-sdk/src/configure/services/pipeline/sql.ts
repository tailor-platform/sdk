import type { ResolverOptions, StepOptions, StepReturnable } from "./types";

type execQuery = <T>(query: string, params?: readonly unknown[]) => Promise<T>;

export type SqlClient = {
  readonly exec: execQuery;
  readonly execOne: execQuery;
};

type HasDbNamespace<
  RO extends ResolverOptions,
  SO extends StepOptions,
> = RO extends { defaults: { dbNamespace: string } }
  ? true
  : SO extends { dbNamespace: string }
    ? true
    : false;

export type sqlFactory<
  C extends Record<string, unknown>,
  RO extends ResolverOptions,
  SO extends StepOptions,
> = (
  input: HasDbNamespace<RO, SO> extends true ? C & { client: SqlClient } : C,
) => StepReturnable | Promise<StepReturnable>;
