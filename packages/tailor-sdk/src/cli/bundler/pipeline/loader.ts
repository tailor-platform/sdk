import { pathToFileURL } from "node:url";
import { type Resolver } from "@/parser/service/pipeline/types";
import { ResolverSchema } from "@/parser/service/pipeline/schema";
import { type ILoader } from "@/cli/bundler";

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
