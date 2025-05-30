import { Resolver } from "../resolver";
import { Step } from "./types";
import { StepType } from "../types";

export class StepExtractor {
  async extractSteps(resolverFilePath: string): Promise<Step[]> {
    const resolverModule = await import(resolverFilePath);
    const resolver = resolverModule.default;

    if (!(resolver instanceof Resolver)) {
      throw new Error(
        `The provided module does not export a Resolver instance. path: ${resolverFilePath}`,
      );
    }

    return resolver.steps.map((
      [type, name, fn]: [StepType, string, Function],
    ) => ({ type, name, fn }));
  }
}
