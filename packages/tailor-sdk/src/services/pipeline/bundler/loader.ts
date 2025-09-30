import { pathToFileURL } from "node:url";
import { type Resolver } from "../resolver";
import { isResolver } from "../utils";
import { type ILoader } from "@/bundler";

export class ResolverLoader
  implements ILoader<Resolver<any, any, any, any, any, any>>
{
  async load(
    resolverFilePath: string,
  ): Promise<Resolver<any, any, any, any, any, any> | null> {
    const resolverModule = await import(
      `${pathToFileURL(resolverFilePath).toString()}?t=${new Date().getTime()}`
    );
    const resolver = resolverModule.default;
    if (!isResolver(resolver)) {
      return null;
    }

    return resolver;
  }
}
