import { 
    resolver,
    functionStep, 
    InputType, 
    InputTypeField,
    Type, 
    TypeField 
} from '@tailor-platform/tailor-sdk';

@InputType()
class HelloWorldInput {
    @InputTypeField()
    public name?: string;
}

@Type()
class HelloWorldOutput {
    @TypeField()
    message?: string;
}

function helloWorld(input: HelloWorldInput): HelloWorldOutput {
  return { message: `Hello, ${input.name || 'World'}!` };
}

const hello = resolver("helloWorld", functionStep("hello", helloWorld, HelloWorldInput, HelloWorldOutput));

export default hello;

