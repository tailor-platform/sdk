import * as path from "pathe";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { withErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { CLIError } from "#/cli/shared/errors";
import { configInvalidError } from "#/cli/shared/validation-errors";
import { ResolverPermissionSchema } from "#/parser/service/resolver/index";
import { checkDefaultPermissionInputs } from "#/parser/service/resolver/permission-operands";
import type { ResolverServiceConfig, ResolverServiceInput } from "#/configure/config/types";
import type { Resolver } from "#/types/resolver.generated";

const ResolverDefaultPermissionSchema = ResolverPermissionSchema.superRefine(
  checkDefaultPermissionInputs,
);

type ParseParams = {
  namespace: string;
  config: ResolverServiceConfig;
  configPath: string;
};

/**
 * Validate a resolver namespace's `defaultPermission` with the same schema as
 * a resolver's own `permission`, so an invalid policy fails the build instead
 * of compiling into a guard that lets everyone through.
 * @param params - The namespace name, its resolver service config, and the config file declaring it
 * @returns The validated default, or `undefined` when the namespace declares none
 */
export function parseResolverDefaultPermission(
  params: ParseParams,
): Resolver["permission"] | undefined {
  const { namespace, config, configPath } = params;
  if (config.defaultPermission === undefined) {
    return undefined;
  }
  const result = ResolverDefaultPermissionSchema.safeParse(config.defaultPermission);
  if (!result.success) {
    throw configInvalidError({
      file: configPath,
      exportName: "default",
      subject: `config for resolver namespace "${namespace}"`,
      error: result.error,
      pathPrefix: ["resolver", namespace, "defaultPermission"],
      service: { configKey: "resolver", name: namespace },
    });
  }
  return result.data;
}

type ResolveForFileParams = {
  config: ResolverServiceInput | undefined;
  filePath: string;
  baseDir: string;
  configPath: string;
};

/**
 * Find the `defaultPermission` of the resolver namespace a file belongs to.
 *
 * `function run` receives a single file rather than a namespace, so the
 * namespace is recovered by matching the file against each namespace's own
 * patterns — otherwise a test run would skip a guard the deployed resolver has.
 *
 * Nothing stops two namespaces' patterns from claiming the same file, and
 * `deploy` then bundles that resolver once per namespace, each with its own
 * default. Picking one here would make the test run agree with only one of
 * the deployed copies, so an ambiguous file is rejected instead.
 * @param params - The config's resolver section, the resolver file, and the config's own directory and path
 * @returns The owning namespace's validated default, or `undefined` when no namespace claims the file
 */
export function resolveResolverDefaultPermissionForFile(
  params: ResolveForFileParams,
): Resolver["permission"] | undefined {
  const { config, filePath, baseDir, configPath } = params;
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
    const namespaces = owners.map((owner) => owner.namespace);
    throw withErrorDiagnostics(
      CLIError({
        code: "RESOLVER_NAMESPACE_AMBIGUOUS",
        message:
          `Resolver ${path.relative(process.cwd(), targetFile)} matches more than one resolver ` +
          `namespace: ${namespaces.map((namespace) => `"${namespace}"`).join(", ")}`,
        details: "Each namespace applies its own `defaultPermission`.",
        suggestion:
          "Narrow the `files` patterns, for example with a `!` pattern, until exactly one " +
          "namespace claims this file.",
        context: { file: configPath, resolverFile: targetFile, namespaces },
      }),
      { location: { file: configPath } },
    );
  }

  const [owner] = owners;
  return owner ? parseResolverDefaultPermission({ ...owner, configPath }) : undefined;
}
