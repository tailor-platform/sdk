import { gqlFactory } from "./gql";
import { sqlFactory } from "./sql";

export type StepType = "fn" | "sql" | "gql";
export type Step<R, Context extends Record<string, unknown>> =
  | (({ input, context }: Context) => R)
  | sqlFactory<Context>
  | gqlFactory<Context>;
export type StepDef<
  S extends string,
  A,
  B,
  Context extends Record<string, unknown> = { input: A },
> =
  | ["fn", S, Step<B, Context>, FnStepOptions | undefined]
  | ["sql", S, Step<B, Context>, SqlStepOptions | undefined]
  | ["gql", S, Step<B, Context>, GqlStepOptions | undefined];

export type FnStepOptions = object;
export type SqlStepOptions = {
  dbNamespace?: string;
};
export type GqlStepOptions = object;
export type StepOptions = FnStepOptions | SqlStepOptions | GqlStepOptions;
export type ResolverOptions = {
  description?: string;
  defaults?: FnStepOptions & SqlStepOptions & GqlStepOptions;
};

export type PipelineResolverServiceConfig = { files: string[] };
export type PipelineResolverServiceInput = {
  [namespace: string]: PipelineResolverServiceConfig;
};

type TemplateLiteralToString<T> = T extends string ? string : T;
export type StepReturn<T> = TemplateLiteralToString<Awaited<T>>;
