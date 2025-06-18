import { Resolver } from "../resolver";
import { measure } from "../../../performance";

export class ResolverLoader {
  @measure
  async load(
    resolverFilePath: string,
  ): Promise<InstanceType<typeof Resolver>> {
    const resolverModule = await import(resolverFilePath);
    const resolver = resolverModule.default;

    if (!(resolver instanceof Resolver)) {
      throw new Error(
        `The provided module does not export a Resolver instance. path: ${resolverFilePath}`,
      );
    }

    return resolver;
  }
}
