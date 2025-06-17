import { gqlFactory } from "./gql";
import { sqlFactory } from "./sql";

export type StepType = "fn" | "sql" | "gql";
export type Step<
  T,
  R,
  Context extends Record<string, unknown>,
> =
  | ((
    { input, context }: {
      input: T;
      context: Context;
    },
  ) => R)
  | sqlFactory<Awaited<T>, Context>
  | gqlFactory<Awaited<T>, Context>;
export type StepDef<
  T extends StepType,
  S extends string,
  A,
  B,
  Context extends Record<string, unknown> = { input: A },
> = [T, S, Step<A, B, Context>];
export type StepOptions = {
  dbNamespace?: string;
};
export type ResolverOptions = {
  description?: string;
  defaults: StepOptions;
};

export type PipelineResolverServiceConfig = { files: string[] };
export type PipelineResolverServiceInput = {
  [namespace: string]: PipelineResolverServiceConfig;
};
