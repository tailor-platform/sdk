import { type sqlFactory } from "./sql";
import {
  type ResolverOptions,
  type StepOptions,
  type Step,
  type StepReturn,
  type QueryType,
} from "./types";
import { type TailorType } from "@/configure/types/type";
import { type output } from "@/configure/types/helpers";
import type { TailorUser } from "@/configure/types";
import type { Exact } from "type-fest";

export class Resolver<
  Context extends Record<string, unknown> = any,
  Output extends TailorType<any, any> = any,
  Options extends ResolverOptions = ResolverOptions,
> {
  readonly _output = null as unknown as Output;
  readonly _context = null as unknown as Context;

  #steps: Step[];
  get steps() {
    return this.#steps as ReadonlyArray<Step>;
  }

  #options: ResolverOptions;
  get options() {
    return this.#options as Readonly<ResolverOptions>;
  }

  #output = null as unknown as Output;
  get output() {
    return this.#output as Readonly<Output>;
  }

  #outputMapper = null as unknown as (c: Context) => output<Output>;
  get outputMapper() {
    return this.#outputMapper as Readonly<(c: Context) => output<Output>>;
  }

  constructor(
    public readonly queryType: QueryType,
    public readonly name: string,
    public readonly input: TailorType<any, any> | undefined,
    options: ResolverOptions = { defaults: {} },
  ) {
    this.#steps = [];
    this.#options = options;
  }

  fnStep<
    const S extends string,
    const Q extends sqlFactory<Context, Options, SO>,
    SO extends StepOptions,
  >(name: S, fn: Q, options?: SO) {
    this.#steps.push(["fn", name, fn, options]);
    return this as unknown as Resolver<
      Context & Record<S, StepReturn<ReturnType<Q>>>,
      Output,
      Options
    >;
  }

  returns<R extends Exact<output<O>, R>, O extends TailorType<any, any>>(
    map: (context: Context) => R,
    output: O,
  ) {
    this.#outputMapper = map as any;
    this.#output = output as any;
    return this as unknown as Resolver<Context, O, Options>;
  }
}

export function createQueryResolver<
  const Input extends TailorType<any, any>,
  Options extends ResolverOptions,
>(
  name: string,
  input: Input,
  options?: Options,
): Resolver<{ input: output<Input>; user: TailorUser }, never, Options>;
export function createQueryResolver<Options extends ResolverOptions>(
  name: string,
  options?: Options,
): Resolver<{ user: TailorUser }, never, Options>;
export function createQueryResolver(
  name: string,
  input?: TailorType<any, any> | ResolverOptions,
  options?: ResolverOptions,
) {
  if (input && "_output" in input) {
    return new Resolver("query", name, input, options);
  }
  return new Resolver("query", name, undefined, input);
}

export function createMutationResolver<
  const Input extends TailorType<any, any>,
  Options extends ResolverOptions,
>(
  name: string,
  input: Input,
  options?: Options,
): Resolver<{ input: output<Input>; user: TailorUser }, never, Options>;
export function createMutationResolver<Options extends ResolverOptions>(
  name: string,
  options?: Options,
): Resolver<{ user: TailorUser }, never, Options>;
export function createMutationResolver(
  name: string,
  input?: TailorType<any, any> | ResolverOptions,
  options?: ResolverOptions,
) {
  if (input && "_output" in input) {
    return new Resolver("mutation", name, input, options);
  }
  return new Resolver("mutation", name, undefined, input);
}
