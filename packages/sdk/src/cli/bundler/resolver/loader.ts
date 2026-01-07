import { pathToFileURL } from "node:url";
import { type Resolver, ResolverSchema } from "@/parser/service/resolver";

/**
 * Load and validate a resolver definition from a file.
 * @param {string} resolverFilePath - Path to the resolver file
 * @returns {Promise<Resolver | null>} Parsed resolver or null if invalid
 */
export async function loadResolver(resolverFilePath: string): Promise<Resolver | null> {
  const resolverModule = await import(pathToFileURL(resolverFilePath).href);
  const resolver = resolverModule.default;

  const parseResult = ResolverSchema.safeParse(resolver);
  if (!parseResult.success) {
    return null;
  }

  return parseResult.data;
}
