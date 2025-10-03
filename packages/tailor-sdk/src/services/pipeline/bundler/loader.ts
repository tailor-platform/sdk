import { pathToFileURL } from "node:url";
import { type Resolver } from "../resolver";
import { isResolver } from "../utils";
import { type ILoader } from "@/bundler";

export class ResolverLoader implements ILoader<Resolver> {
  async load(resolverFilePath: string): Promise<Resolver | null> {
    const resolverModule = await import(
      `${pathToFileURL(resolverFilePath).href}?t=${Date.now()}`
    );
    const resolver = resolverModule.default;
    if (!isResolver(resolver)) {
      return null;
    }

    return resolver;
  }
}
