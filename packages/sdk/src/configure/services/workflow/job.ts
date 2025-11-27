import type { CamelCase } from "type-fest";

/**
 * Symbol used to brand WorkflowJob objects created by createWorkflowJob.
 * This enables reliable runtime detection of workflow jobs regardless of
 * how they were imported or assigned (variable reassignment, destructuring, etc.)
 */
export const WORKFLOW_JOB_BRAND = Symbol.for("tailor:workflow-job");

type JobsFromDeps<
  Deps extends readonly WorkflowJob<any, any, any, any>[],
  Set extends string = never,
> = Deps extends [
  infer First extends WorkflowJob<any, any, any, any>,
  ...infer Rest extends readonly WorkflowJob<any, any, any, any>[],
]
  ? First["name"] extends Set
    ? JobsFromDeps<Rest, Set> // Skip duplicate jobs
    : First extends WorkflowJob<infer N, infer I, infer O, infer NestedDeps>
      ? {
          [K in CamelCase<N>]: [I] extends [undefined]
            ? () => Promise<O>
            : (input: I) => Promise<O>;
        } & (NestedDeps extends []
          ? object
          : JobsFromDeps<NestedDeps, Set | N>) &
          JobsFromDeps<Rest, Set | N>
      : JobsFromDeps<Rest, Set>
  : object;

export interface WorkflowJob<
  Name extends string = string,
  Input = any,
  Output = any,
  Deps extends readonly [...WorkflowJob<any, any, any, any>[]] = [],
> {
  readonly [WORKFLOW_JOB_BRAND]?: true;
  name: Name;
  deps?: Deps;
  body: (input: Input, jobs: JobsFromDeps<Deps>) => Output | Promise<Output>;
}

type WorkflowJobBody<
  I,
  O,
  Deps extends readonly WorkflowJob<any, any, any, any>[],
> = (input: I, jobs: JobsFromDeps<Deps>) => O | Promise<O>;

interface CreateWorkflowJobFunction {
  <
    const Deps extends readonly [...WorkflowJob<any, any, any, any>[]] = [],
    const Name extends string = string,
    const Body extends WorkflowJobBody<any, any, Deps> = WorkflowJobBody<
      any,
      any,
      Deps
    >,
  >(
    config: Deps extends readonly [any, ...any[]]
      ? {
          readonly name: Name;
          readonly deps: Deps;
          readonly body: Body;
        }
      : {
          readonly name: Name;
          readonly deps?: never;
          readonly body: Body;
        },
  ): WorkflowJob<Name, Parameters<Body>[0], ReturnType<Body>, Deps>;
}

export const createWorkflowJob: CreateWorkflowJobFunction = function <
  const Deps extends readonly [...WorkflowJob<any, any, any, any>[]] = [],
  const Name extends string = string,
  const Body extends WorkflowJobBody<any, any, Deps> = WorkflowJobBody<
    any,
    any,
    Deps
  >,
>(
  config: Deps extends readonly [any, ...any[]]
    ? {
        readonly name: Name;
        readonly deps: Deps;
        readonly body: Body;
      }
    : {
        readonly name: Name;
        readonly deps?: never;
        readonly body: Body;
      },
) {
  return {
    [WORKFLOW_JOB_BRAND]: true,
    name: config.name,
    deps: (config as any).deps,
    body: config.body,
  } as WorkflowJob<Name, Parameters<Body>[0], ReturnType<Body>, Deps>;
};
