import { pathToFileURL } from "node:url";
import { type ILoader } from "@/cli/bundler";
import { type Resolver, ResolverSchema } from "@/parser/service/resolver";

export class ResolverLoader implements ILoader<Resolver> {
  async load(resolverFilePath: string): Promise<Resolver | null> {
    const resolverModule = await import(
      `${pathToFileURL(resolverFilePath).href}?t=${Date.now()}`
    );
    const resolver = resolverModule.default;

    const parseResult = ResolverSchema.safeParse(resolver);
    if (!parseResult.success) {
      return null;
    }

    return parseResult.data;
  }
}
