import { pathToFileURL } from "node:url";
import { type Resolver, ResolverSchema } from "@/parser/service/resolver";

export async function loadResolver(
  resolverFilePath: string,
): Promise<Resolver | null> {
  const resolverModule = await import(pathToFileURL(resolverFilePath).href);
  const resolver = resolverModule.default;

  const parseResult = ResolverSchema.safeParse(resolver);
  if (!parseResult.success) {
    return null;
  }

  return parseResult.data;
}
