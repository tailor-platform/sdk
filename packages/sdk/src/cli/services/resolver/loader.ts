import { importUserFile } from "#/cli/shared/import-user-file";
import { ResolverSchema } from "#/parser/service/resolver/index";
import type { Resolver } from "#/types/resolver.generated";

/**
 * Load and validate a resolver definition from a file.
 * @param resolverFilePath - Path to the resolver file
 * @param baseDir - Directory the resolver's tsconfig is resolved against
 * @returns Parsed resolver or null if invalid
 */
export async function loadResolver(
  resolverFilePath: string,
  baseDir: string,
): Promise<Resolver | null> {
  const resolverModule = await importUserFile(resolverFilePath, baseDir);
  const resolver = resolverModule.default;

  const parseResult = ResolverSchema.safeParse(resolver);
  if (!parseResult.success) {
    return null;
  }

  return parseResult.data;
}
