import * as path from "pathe";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { ResolverPermissionSchema } from "#/parser/service/resolver/index";
import type { ResolverServiceConfig, ResolverServiceInput } from "#/configure/config/types";
import type { Resolver } from "#/types/resolver.generated";

type ParseParams = {
  namespace: string;
  config: ResolverServiceConfig;
};

/**
 * Validate a resolver namespace's `defaultPermission` with the same schema as
 * a resolver's own `permission`, so an invalid policy fails the build instead
 * of compiling into a guard that lets everyone through.
 * @param params - The namespace name and its resolver service config
 * @returns The validated default, or `undefined` when the namespace declares none
 */
export function parseResolverDefaultPermission(
  params: ParseParams,
): Resolver["permission"] | undefined {
  const { namespace, config } = params;
  if (config.defaultPermission === undefined) {
    return undefined;
  }
  const result = ResolverPermissionSchema.safeParse(config.defaultPermission);
  if (!result.success) {
    throw new Error(
      `Invalid \`defaultPermission\` for resolver namespace "${namespace}": ` +
        result.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return result.data;
}

type ResolveForFileParams = {
  config: ResolverServiceInput | undefined;
  filePath: string;
  baseDir: string;
};

/**
 * Find the `defaultPermission` of the resolver namespace a file belongs to.
 *
 * `function test-run` receives a single file rather than a namespace, so the
 * namespace is recovered by matching the file against each namespace's own
 * patterns — otherwise a test run would skip a guard the deployed resolver has.
 *
 * Nothing stops two namespaces' patterns from claiming the same file, and
 * `deploy` then bundles that resolver once per namespace, each with its own
 * default. Picking one here would make the test run agree with only one of
 * the deployed copies, so an ambiguous file is rejected instead.
 * @param params - The config's resolver section, the resolver file, and the config's own directory
 * @returns The owning namespace's validated default, or `undefined` when no namespace claims the file
 */
export function resolveResolverDefaultPermissionForFile(
  params: ResolveForFileParams,
): Resolver["permission"] | undefined {
  const { config, filePath, baseDir } = params;
  if (!config) {
    return undefined;
  }

  // Globbed paths keep the platform's own separators; `path.resolve` here is
  // pathe's, which normalizes both sides to the same form before comparing.
  const targetFile = path.resolve(filePath);
  const owners: Array<{ namespace: string; config: ResolverServiceConfig }> = [];
  for (const [namespace, serviceConfig] of Object.entries(config)) {
    if ("external" in serviceConfig) {
      continue;
    }
    const files = loadFilesWithIgnores(serviceConfig, baseDir);
    if (files.some((file) => path.resolve(file) === targetFile)) {
      owners.push({ namespace, config: serviceConfig });
    }
  }

  if (owners.length > 1) {
    throw new Error(
      `Resolver ${path.relative(process.cwd(), targetFile)} matches more than one resolver ` +
        `namespace: ${owners.map((owner) => `"${owner.namespace}"`).join(", ")}. ` +
        `Each namespace applies its own \`defaultPermission\`, so narrow the \`files\`/` +
        `\`ignores\` patterns until exactly one namespace claims this file.`,
    );
  }

  const [owner] = owners;
  return owner ? parseResolverDefaultPermission(owner) : undefined;
}
