import { Resolver } from "../resolver";
import { ResolverSummary } from "./types";

export class ResolverExtractor {
  async summarize(
    resolverFilePath: string,
  ): Promise<ResolverSummary> {
    const resolverModule = await import(resolverFilePath);
    const resolver = resolverModule.default;

    if (!(resolver instanceof Resolver)) {
      throw new Error(
        `The provided module does not export a Resolver instance. path: ${resolverFilePath}`,
      );
    }

    const steps = resolver.steps.map((
      [type, name, fn]: typeof resolver.steps[number],
    ) => ({ type, name, fn }));
    return { name: resolver.name, steps };
  }
}
