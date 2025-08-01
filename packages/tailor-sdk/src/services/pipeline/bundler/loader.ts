import { Resolver } from "../resolver";
import { isResolver } from "../utils";
import { ILoader } from "@/bundler";

export class ResolverLoader
  implements ILoader<Resolver<any, any, any, any, any, any>>
{
  async load(
    resolverFilePath: string,
  ): Promise<Resolver<any, any, any, any, any, any>> {
    const resolverModule = await import(resolverFilePath);
    const resolver = resolverModule.default;
    if (!isResolver(resolver)) {
      throw new Error(
        `The provided module does not export a Resolver instance. path: ${resolverFilePath}`,
      );
    }

    return resolver;
  }
}
