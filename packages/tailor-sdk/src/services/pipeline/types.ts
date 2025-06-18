import { gqlFactory } from "./gql";
import { sqlFactory } from "./sql";

export type StepType = "fn" | "sql" | "gql";
export type Step<
  T,
  R,
  Context extends Record<string, unknown>,
> =
  | (({ input, context }: Context & { input: T }) => R)
  | sqlFactory<Awaited<T>, Context>
  | gqlFactory<Awaited<T>, Context>;
export type StepDef<
  S extends string,
  A,
  B,
  Context extends Record<string, unknown> = { input: A },
> = [
  "fn",
  S,
  Step<A, B, Context>,
  FnStepOptions | undefined,
] | [
  "sql",
  S,
  Step<A, B, Context>,
  SqlStepOptions | undefined,
] | [
  "gql",
  S,
  Step<A, B, Context>,
  GqlStepOptions | undefined,
];

export type FnStepOptions = {};
export type SqlStepOptions = {
  dbNamespace?: string;
};
export type GqlStepOptions = {};
export type StepOptions = FnStepOptions | SqlStepOptions | GqlStepOptions;
export type ResolverOptions = {
  description?: string;
  defaults?: FnStepOptions & SqlStepOptions & GqlStepOptions;
};

export type PipelineResolverServiceConfig = { files: string[] };
export type PipelineResolverServiceInput = {
  [namespace: string]: PipelineResolverServiceConfig;
};
