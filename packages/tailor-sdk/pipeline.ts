import {
  PipelineResolver,
  PipelineResolver_Pipeline,
  PipelineResolver_OperationType,
  AuthInvoker,
} from "@tailor-inc/operator-client";


import { rollup } from 'rollup';

import { createRollupConfig } from "./rollup/config";
import { generateSDLForTypeAndDependencies, generateSDLForType } from "./schema-generator";
const fs = require('fs');
const path = require('path');



export class PipelineResolverService {
  resolvers: PipelineResolver[] = [];
  constructor(public name: string) {

  }

  async build() {
    // Get file listing 
    const resolversDir = path.join(process.cwd(), 'src/resolvers');
    const cfg = createRollupConfig({
      input: fs.readdirSync(resolversDir).map((file: string) => path.join(resolversDir, file)),
    });
    const bundle = await rollup(cfg);
    try {
      if (Array.isArray(cfg.output)) {
        for (const output of cfg.output) {
          await bundle.write(output);
        }
      } else if (cfg.output) {
        await bundle.write(cfg.output);
      } else {
        throw new Error('No output configuration found in rollup config');
      }
    } finally {
      // Close bundle to avoid memory leaks
      await bundle.close();
    }
    console.log('Bundle created successfully');

    console.log(`Writing resolvers to dist/pipelines ${this.resolvers.length}`);
    for (const resolver of this.resolvers) {
      resolver.pipelines.forEach((pipeline) => {
        switch (pipeline.operationType) {
          case PipelineResolver_OperationType.FUNCTION:
            const functionPath = path.join("dist/functions", `${resolver.name}.js`);
            const functionCode = fs.readFileSync(functionPath, 'utf-8');
            pipeline.operationSource = functionCode;
            break;
          default:
            console.log(`Unsupported operation type: ${pipeline.operationType}`);
            break;
        }
      });
      if (!fs.existsSync("dist/pipelines")) {
        fs.mkdirSync("dist/pipelines", { recursive: true });
      }
      const resolverPath = path.join("dist/pipelines", `${resolver.name}.json`);
      fs.writeFileSync(resolverPath, JSON.stringify(resolver, null, 2));
      console.log(`Resolver ${resolver.name} written to ${resolverPath}`);
    }
  }


  addResolver<IN, OUT>(resolverConfig: ResolverConfigMetadata<IN, OUT>) {
    console.log(`Adding resolver: ${resolverConfig.name}`);

    // Extracting type names - assuming generateSDLForType returns SDL with type definitions
    // If you need just the type names, you might need to parse them from the SDL or
    // implement a way to get just the type names directly

    const sdlInput = resolverConfig.steps.map((step) => step.sdl).join('\n');

    let sdl = `${sdlInput}
  extend type Query {
    ${resolverConfig.name}(input: ${resolverConfig.queryType}): ${resolverConfig.queryType}
  }
  extend type Mutation {
    ${resolverConfig.name}(input: ${resolverConfig.queryType}): ${resolverConfig.queryType}
  }
`;
    
    const resolver = new PipelineResolver({
      name: resolverConfig.name,
      sdl: sdl,
      pipelines: resolverConfig.steps.map((step) => {
        switch (step.kind) {
          case 'function':
            return new PipelineResolver_Pipeline({
              name: step.name,
              description: step.name,
              operationType: PipelineResolver_OperationType.FUNCTION,
              operationSource: "",
              operationName: step.name,
            });
          case 'sql':
            return new PipelineResolver_Pipeline({
              name: step.name,
              description: step.name,
              operationType: PipelineResolver_OperationType.FUNCTION,
              operationSource: "",
              operationName: step.name,
            });
          case 'graphql':
            return new PipelineResolver_Pipeline({
              name: step.name || 'graphql',
              description: step.name || 'GraphQL Operation',
              operationType: PipelineResolver_OperationType.GRAPHQL,
              operationSource: '',
              operationName: step.name || 'graphql',
            });
          default:
            throw new Error(`Unsupported step kind: ${step.kind}`);
        }
      })
    });
    this.resolvers.push(resolver);
  }

}

type ResolverConfigMetadata<IN, OUT> = {
  name: string,
  queryType?: string,
  steps: StepConfig[]
}

type StepsConfig<IN, OUT> = {
}

type StepConfig = {
  kind: 'graphql' | 'function' | 'sql',
  name?: string,
  func?: Function,
  sdl?: string,
  variables?: any
}

export function queryResolver<IN, OUT>(name: string, steps: StepConfig|StepConfig[]): ResolverConfigMetadata<IN, OUT> {
  return {
    name: name,
    queryType: "query",
    steps: Array.isArray(steps) ? steps : [steps]
  }
}

export function resolver<IN extends Function, OUT>(name: string, steps: StepConfig|StepConfig[]): ResolverConfigMetadata<IN, OUT> {
  return {
    name: name,
    queryType: "mutation",
    steps: Array.isArray(steps) ? steps : [steps]
  }
}

export function steps <IN extends Function ,OUT extends Function>(...steps: StepConfig[]): StepsConfig<IN, OUT> {
  return {

  }
}

class FunctionArgument<Req, Res> {
  constructor(public name: string, public type: string) {}

}

type FunctionCall = <Req, Res>(args: FunctionArgument<Req, Res>) => boolean


type Constructor<T> = { new (...args: any[]): T };

export const functionStep = <IN, OUT>(name: string, func: (input: IN) => OUT, inCtor: Constructor<IN>, outCtor: Constructor<OUT>): StepConfig => {
  let sdl= generateSDLForTypeAndDependencies(inCtor); 
  sdl  += generateSDLForTypeAndDependencies(outCtor);

  return {
    kind: 'function',
    name: name,
    func: func,
    variables: 'args',
    sdl: sdl
  }
}

interface SQLStepConfig {
  kind: 'sql',
  name?: string,
  sql: string,
  variables?: any
}

export const sqlStep = <IN, OUT>(name: string, namespace:string, sql: string, inCtor: Constructor<IN>, outCtor: Constructor<OUT>): StepConfig => {
  let sdl= generateSDLForTypeAndDependencies(inCtor); 
  sdl  += generateSDLForTypeAndDependencies(outCtor);
  return {
    kind: 'sql',
    name: name,
    sdl: sdl,
    variables: "args.input"
  }
}

export function generateResolverConfig<IN, OUT>(resolver: ResolverConfigMetadata<IN, OUT>): PipelineResolver {
  resolver.steps.forEach((step) => {
    switch (step.kind) {
      case 'function':
        // Generate SDL for function step
      case 'sql':
        // Generate SDL for SQL step
      case 'graphql':
        // Generate SDL for GraphQL step
    }
  });
//   let sdl = generateSDLForType({} as IN);
//   sdl += generateSDLForType({} as OUT);
//   sdl += `
// extend type Mutation {
//   ${resolver.name}(input: in): out
// }
// `;

  const resolverConfig = new PipelineResolver({
    // name: resolver.name,
    // sdl: sdl,
    // pipelines: resolver.steps.map((step) => {
    //   switch (step.kind) {
    //     case 'function':
    //       return new PipelineResolver_Pipeline({
    //           name: step.name,
    //           description: step.name,
    //           operationType: PipelineResolver_OperationType.FUNCTION,
    //           operationSource: step.function.toString(),
    //           operationName: step.name,
    //           // invoker: new AuthInvoker({
    //           // }),
    //       });
    //     case 'sql':
    //       return new PipelineResolver_Pipeline({
    //           name: step.name,
    //           description: step.name,
    //       });
    //   }
    // })
  });
  return resolverConfig;
}


