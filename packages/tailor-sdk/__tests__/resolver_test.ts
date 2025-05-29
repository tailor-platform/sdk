import {
  resolver,
  functionStep,
  InputType,
  InputTypeField,
  Type,
  TypeField,
  generateResolverConfig,
  steps
} from '@tailor-platform/tailor-sdk';
import { test } from 'vitest';

@InputType()
export class HelloWorldInput {
  @InputTypeField()
  public name?: string;
}

@Type()
export class HelloWorldOutput {
  @TypeField()
  message?: string;
}

function helloWorld(input: HelloWorldInput): HelloWorldOutput {
  return { message: `Hello, ${input.name || 'World'}!` };
}

const hello = resolver("helloWorld", functionStep("hello", helloWorld, HelloWorldInput, HelloWorldOutput));

test('Resolver config generation', () => {
  const config = generateResolverConfig(hello);
  //console.log('Generated Resolver Config:', config);
});




// const firstStep = (input: string):string => {
//   return input + " : firstStep";
// }

// const secondStep = (input: string):string => {
//   return input + " : secondStep";
// }


// const helloChain = resolver(
//   "helloWorld", steps(
//     HelloWorldInput, HelloWorldOutput,
//     functionStep("first", firstStep),
//     functionStep("second", secondStep)
//   )
// );

// class CreateSOInput {
// }
// class CreateSOOutput {
// }

// class Context<Req, Res> {
//   constructor(private req: Req) {}
//   getRequest(): Req {
//     return this.req;
//   }
// }

// function checkAuth(input: CreateSOInput): CreateSOOutput {
//   return input;
// }
// function createHistory(input: CreateSOInput): CreateSOOutput {
//   return input;
// }
// function processSo(input: CreateSOInput): CreateSOOutput {
//   return input;
// }
// function makeResponse(input: CreateSOInput): CreateSOOutput {
//   return input;
// }

// const createSo = resolver<CreateSOInput, CreateSOOutput>(
//   "createSo", steps(
//     functionStep("auth", checkAuth),
//     functionStep("createHistory", createHistory),
//     functionStep("processSo", processSo),
//     functionStep("makeResponse", makeResponse),
//   )
// );



