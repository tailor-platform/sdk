import { type DeepWidening } from "@/types/helpers";
import { type sqlFactory } from "./sql";
import type { JsonValue } from "type-fest";

export type QueryType = "query" | "mutation";

export type Step = [
  "fn",
  string,
  sqlFactory<never, ResolverOptions, StepOptions>,
  StepOptions | undefined,
];

export type StepOptions = {
  dbNamespace?: string;
};
export type ResolverOptions = {
  description?: string;
  defaults?: StepOptions;
};

export type PipelineResolverServiceConfig = { files: string[] };
export type PipelineResolverServiceInput = {
  [namespace: string]: PipelineResolverServiceConfig;
};

// Following Platform behavior, pass undefined and void as null to the next step.
export type StepReturn<T> = DeepWidening<
  Awaited<T extends undefined | void ? null : T>
>;

// Following Platform behavior, restrict to return only JSON-serializable values.
export type StepReturnable = JsonValue | undefined | void;
