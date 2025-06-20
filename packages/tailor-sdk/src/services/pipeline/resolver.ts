/* eslint-disable @typescript-eslint/no-explicit-any */

import path from "node:path";
import fs from "node:fs";
import multiline from "multiline-ts";
import { gqlFactory } from "./gql";
import { sqlFactory } from "./sql";
import {
  FnStepOptions,
  GqlStepOptions,
  ResolverOptions,
  SqlStepOptions,
  Step,
  StepDef,
} from "./types";
import { TailorType } from "../../types/type";
import { output } from "../../types/helpers";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import { SchemaGenerator } from "../../schema-generator";
import { capitalize } from "es-toolkit";
import { getDistPath } from "../../tailor";

export class Resolver<
  QueryType extends "query" | "mutation",
  Input extends TailorType<any, any, any>,
  CurrentOutput,
  Context extends Record<string, unknown>,
  Steps extends StepDef<string, any, any, any>[],
  Output extends TailorType<any, any, any>,
> {
  readonly _input = null as output<Input>;
  readonly _output = null as output<Output>;
  readonly _context = null as unknown as Context;
  private _steps: Steps;
  #options: ResolverOptions;

  private output = null as unknown as Output;

  constructor(
    public readonly queryType: QueryType,
    public readonly name: string,
    private readonly input: TailorType<any, any, Input>,
    options: ResolverOptions = { defaults: {} },
  ) {
    this._steps = [] as unknown as Steps;
    this.#options = options;
  }

  get options() {
    return this.#options as Readonly<ResolverOptions>;
  }

  get steps() {
    return Array.from(this._steps) as Steps;
  }

  fnStep<const S extends string, const R>(
    name: S,
    fn: (context: Context) => R | Promise<R>,
    _options?: FnStepOptions,
  ) {
    this._steps.push(["fn", name, fn, _options]);
    return this as unknown as Resolver<
      QueryType,
      Input,
      Awaited<R>,
      Context & Record<S, Awaited<R>>,
      [...Steps, ["fn", S, Step<R, Context>, FnStepOptions]],
      Output
    >;
  }

  sqlStep<const S extends string, const Q extends sqlFactory<Context>>(
    name: S,
    fn: Q,
    options?: SqlStepOptions,
  ) {
    this._steps.push(["sql", name, fn, options]);
    return this as unknown as Resolver<
      QueryType,
      Input,
      Awaited<ReturnType<Q>>,
      Context & Record<S, Awaited<ReturnType<Q>>>,
      [...Steps, ["sql", S, Step<ReturnType<Q>, Context>, SqlStepOptions]],
      Output
    >;
  }

  gqlStep<const S extends string, const Q extends gqlFactory<Context>>(
    name: S,
    fn: Q,
    _options?: GqlStepOptions,
  ) {
    this._steps.push(["gql", name, fn, _options]);
    return this as unknown as Resolver<
      QueryType,
      Input,
      Awaited<ReturnType<Q>>["data"],
      Context & Record<S, ReturnType<Q>>,
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

  returns<const O extends TailorType<any, any, any>>(
    output: Context extends output<O> ? O : never,
  ) {
    this.output = output as any;
    return this as unknown as Resolver<
      QueryType,
      Input,
      CurrentOutput,
      Context,
      Steps,
      O
    >;
  }

  toSDLMetadata() {
    if (!this.output) {
      throw new Error(
        `Resolver "${this.name}" must have an output type defined. Use .returns() to specify the output type.`,
      );
    }

    const input = this.input.toSDLMetadata(true);
    const output = this.output.toSDLMetadata();
    const sdl = multiline/* gql */ `
    ${SchemaGenerator.generateSDLFromMetadata(input)}
    ${SchemaGenerator.generateSDLFromMetadata(output)}
    extend type ${capitalize(this.queryType)} {
      ${this.name}(input: ${input.name}): ${output.name}
    }
    `;
    return {
      name: this.name,
      sdl,
      pipelines: this._steps.map((step) => {
        const [type, name] = step;
        switch (type) {
          case "fn":
          case "sql":
            // eslint-disable-next-line no-case-declarations
            const functionPath = path.join(
              getDistPath(),
              "functions",
              `${this.name}__${name}.js`,
            );
            // eslint-disable-next-line no-case-declarations
            let functionCode = "";
            try {
              functionCode = fs.readFileSync(functionPath, "utf-8");
            } catch {
              console.warn(`Function file not found: ${functionPath}`);
            }
            return {
              name,
              description: name,
              operationType: PipelineResolver_OperationType.FUNCTION,
              operationSource: functionCode,
              operationName: name,
            };
          case "gql":
            return {
              name,
              description: name,
              operationType: PipelineResolver_OperationType.GRAPHQL,
              operationSource: "",
              operationName: name,
            };
          default:
            throw new Error(`Unsupported step kind: ${step[0]}`);
        }
      }),
    };
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
