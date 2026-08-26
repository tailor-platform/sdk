import { importUserModule } from "#/cli/shared/user-modules";
import { ResolverSchema } from "#/parser/service/resolver/index";
import type { Resolver } from "#/types/resolver.generated";

/**
 * Load and validate a resolver definition from a file.
 * @param resolverFilePath - Path to the resolver file
 * @returns Parsed resolver or null if invalid
 */
export async function loadResolver(resolverFilePath: string): Promise<Resolver | null> {
  const resolverModule = await importUserModule(resolverFilePath);
  const resolver = resolverModule.default;

  const parseResult = ResolverSchema.safeParse(resolver);
  if (!parseResult.success) {
    return null;
  }

  return parseResult.data;
}
