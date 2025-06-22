/* eslint-disable @typescript-eslint/no-explicit-any */

import { gqlFactory } from "./gql";
import { sqlFactory } from "./sql";
import {
  FnStepOptions,
  GqlStepOptions,
  ResolverOptions,
  SqlStepOptions,
  Step,
  StepDef,
  StepReturn,
} from "./types";
import { TailorType } from "../../types/type";
import { output, StrictOutput } from "../../types/helpers";

export class Resolver<
  QueryType extends "query" | "mutation" = any,
  Input extends TailorType<any, any, any> = any,
  _CurrentOutput = any,
  Context extends Record<string, unknown> = any,
  Steps extends StepDef<string, any, any, any>[] = any,
  Output extends TailorType<any, any, any> = any,
> {
  readonly _input = null as output<Input>;
  readonly _output = null as output<Output>;
  readonly _context = null as unknown as Context;

  #steps = [] as unknown as Steps;
  private set steps(value: Steps) {
    this.#steps = value;
  }
  get steps() {
    return Array.from(this.#steps) as Steps;
  }

  #options = {} as ResolverOptions;
  private set options(value: ResolverOptions) {
    this.#options = value;
  }
  get options() {
    return this.#options as Readonly<ResolverOptions>;
  }

  #output = null as unknown as Output;
  private set output(value: Output) {
    this.#output = value;
  }
  get output() {
    return this.#output as Output;
  }

  #outputMapper = null as unknown as (c: Context) => Output;
  private set outputMapper(value: (c: Context) => Output) {
    this.#outputMapper = value;
  }
  get outputMapper() {
    return this.#outputMapper as (c: Context) => Output;
  }

  constructor(
    public readonly queryType: QueryType,
    public readonly name: string,
    public readonly input: TailorType<any, any, Input>,
    options: ResolverOptions = { defaults: {} },
  ) {
    this.steps = [] as unknown as Steps;
    this.options = options;
  }

  fnStep<const S extends string, const R>(
    name: S,
    fn: (context: Context) => R | Promise<R>,
    _options?: FnStepOptions,
  ) {
    this.#steps.push(["fn", name, fn, _options]);
    return this as unknown as Resolver<
      QueryType,
      Input,
      Awaited<R>,
      Context & Record<S, StepReturn<R>>,
      [...Steps, ["fn", S, Step<R, Context>, FnStepOptions]],
      Output
    >;
  }

  sqlStep<const S extends string, const Q extends sqlFactory<Context>>(
    name: S,
    fn: Q,
    options?: SqlStepOptions,
  ) {
    this.#steps.push(["sql", name, fn, options]);
    return this as unknown as Resolver<
      QueryType,
      Input,
      Awaited<ReturnType<Q>>,
      Context & Record<S, StepReturn<ReturnType<Q>>>,
      [...Steps, ["sql", S, Step<ReturnType<Q>, Context>, SqlStepOptions]],
      Output
    >;
  }

  gqlStep<const S extends string, const Q extends gqlFactory<Context>>(
    name: S,
    fn: Q,
    _options?: GqlStepOptions,
  ) {
    this.#steps.push(["gql", name, fn, _options]);
    return this as unknown as Resolver<
      QueryType,
      Input,
      Awaited<ReturnType<Q>>["data"],
      Context & Record<S, StepReturn<ReturnType<Q>>>,
      [
        ...Steps,
        [
          "gql",
          S,
          Step<Awaited<ReturnType<Q>>["data"], Context>,
          GqlStepOptions,
        ],
      ],
      Output
    >;
  }

  returns<
    R extends Record<string, unknown>,
    const O extends TailorType<any, any, R>,
  >(
    map: (context: Context) => StrictOutput<O, R>,
    output: O,
  ): Resolver<QueryType, Input, output<O>, Context, Steps, O> {
    this.outputMapper = map as any;
    this.output = output as any;
    return this as unknown as Resolver<
      QueryType,
      Input,
      output<O>,
      Context,
      Steps,
      O
    >;
  }

}

export function createQueryResolver<
  const Input extends TailorType<any, any, any>,
>(name: string, input: Input, options?: ResolverOptions) {
  return new Resolver<
    "query",
    Input,
    output<Input>,
    { input: output<Input> },
    [],
    never
  >("query", name, input, options);
}

export function createMutationResolver<
  const Input extends TailorType<any, any, any>,
>(name: string, input: Input, options?: ResolverOptions) {
  return new Resolver<
    "mutation",
    Input,
    output<Input>,
    { input: output<Input> },
    [],
    never
  >("mutation", name, input, options);
}
