import { getTsconfig } from "get-tsconfig";
import { TAILOR_FILE_EXTENSION } from "./tailor-file-extension";

interface ContentMapperEntry {
  package?: unknown;
  extensions?: unknown;
}

const SDK_PACKAGE = "@tailor-platform/sdk";

function isSdkMapper(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const { package: name, extensions } = entry as ContentMapperEntry;
  return (
    name === SDK_PACKAGE && Array.isArray(extensions) && extensions.includes(TAILOR_FILE_EXTENSION)
  );
}

/**
 * Tell whether the tsconfig that applies to a config file has the SDK's
 * content mapper read `.tailor` files, the way TypeScript's language server
 * picks the project: the nearest tsconfig.json that includes the file, with
 * `extends` resolved.
 * @param configPath - Path of `tailor.config.ts`
 * @returns true when the mapper is enabled; false when it is not or the tsconfig cannot be read
 */
export function isContentMapperEnabled(configPath: string): boolean {
  try {
    const config = getTsconfig(configPath, "tsconfig.json", undefined, true)?.config as
      | { contentMappers?: unknown }
      | undefined;
    return Array.isArray(config?.contentMappers) && config.contentMappers.some(isSdkMapper);
  } catch {
    return false;
  }
}
