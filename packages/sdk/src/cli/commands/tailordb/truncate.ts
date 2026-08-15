import { arg } from "@politty/valibot";
import * as v from "valibot";
import { confirmationArgs, deploymentArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { extractOwnedNamespaces } from "#/cli/shared/config";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { resolveTypeNamespaces } from "#/cli/shared/tailordb-namespace";
import { assertDefined } from "#/utils/assert";

export interface TruncateOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  all?: boolean;
  namespace?: string;
  tables?: string[];
}

interface InternalTruncateOptions extends TruncateOptions {
  yes?: boolean;
}

interface TruncateSingleTypeOptions {
  workspaceId: string;
  namespaceName: string;
  typeName: string;
}

async function truncateSingleType(
  options: TruncateSingleTypeOptions,
  client: Awaited<ReturnType<typeof initOperatorClient>>,
): Promise<void> {
  await client.truncateTailorDBType({
    workspaceId: options.workspaceId,
    namespaceName: options.namespaceName,
    tailordbTypeName: options.typeName,
  });

  logger.success(`Truncated table "${options.typeName}" in namespace "${options.namespaceName}"`);
}

async function truncateNamespace(
  workspaceId: string,
  namespaceName: string,
  client: Awaited<ReturnType<typeof initOperatorClient>>,
): Promise<void> {
  await client.truncateTailorDBTypes({
    workspaceId,
    namespaceName,
  });

  logger.success(`Truncated all tables in namespace "${namespaceName}"`);
}

/**
 * Truncate TailorDB data based on the given options.
 * @param options - Truncate options (all, namespace, or tables)
 * @returns Promise that resolves when truncation completes
 */
export async function truncate(options?: TruncateOptions): Promise<void> {
  return await $truncate({ ...options, yes: true });
}

async function $truncate(options: InternalTruncateOptions = {}): Promise<void> {
  // Load and validate options
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  // Validate arguments
  const hasTables = options.tables && options.tables.length > 0;
  const hasNamespace = !!options.namespace;
  const hasAll = !!options.all;

  // All options are mutually exclusive
  const optionCount = [hasAll, hasNamespace, hasTables].filter(Boolean).length;
  if (optionCount === 0) {
    throw new Error("Please specify one of: --all, --namespace <name>, or table names");
  }
  if (optionCount > 1) {
    throw new Error(
      "Options --all, --namespace, and table names are mutually exclusive. Please specify only one.",
    );
  }

  // Validate config and get namespaces before confirmation
  const { config } = await loadConfig(options.configPath);
  const namespaces = extractOwnedNamespaces(config);

  // Handle --all flag
  if (hasAll) {
    if (namespaces.length === 0) {
      logger.warn("No namespaces found in config file.");
      return;
    }

    if (!options.yes) {
      const namespaceList = namespaces.join(", ");
      const confirmation = await prompt.confirm({
        message: `This will truncate ALL tables in the following owned namespaces (external namespaces are excluded): ${namespaceList}. Continue?`,
        default: false,
      });
      if (!confirmation) {
        logger.info("Truncate cancelled.");
        return;
      }
    }

    for (const namespace of namespaces) {
      await truncateNamespace(workspaceId, namespace, client);
    }
    logger.success("Truncated all tables in all owned namespaces");
    return;
  }

  // Handle --namespace flag
  if (hasNamespace) {
    const namespace = assertDefined(options.namespace, "namespace option missing");

    // Validate namespace exists in config and is not external
    if (!namespaces.includes(namespace)) {
      const dbConfig = config.db?.[namespace];
      if (dbConfig && "external" in dbConfig) {
        throw new Error(
          `Namespace "${namespace}" is declared as external in this app's config and cannot be truncated from here. Run truncate from the app that owns it.`,
        );
      }
      throw new Error(
        `Namespace "${namespace}" not found in config. Available owned namespaces (external namespaces are excluded): ${namespaces.join(", ")}`,
      );
    }

    if (!options.yes) {
      const confirmation = await prompt.confirm({
        message: `This will truncate ALL tables in namespace "${namespace}". Continue?`,
        default: false,
      });
      if (!confirmation) {
        logger.info("Truncate cancelled.");
        return;
      }
    }

    await truncateNamespace(workspaceId, namespace, client);
    return;
  }

  // Handle specific tables
  if (hasTables) {
    const typeNames = assertDefined(options.tables, "tables option missing");

    // Validate all tables exist and get their namespaces before confirmation
    const typeNamespaceMap = await resolveTypeNamespaces({
      workspaceId,
      namespaces,
      typeNames,
      client,
    });
    const notFoundTables = typeNames.filter((typeName) => !typeNamespaceMap.has(typeName));

    if (notFoundTables.length > 0) {
      throw new Error(
        `The following tables were not found in any namespace: ${notFoundTables.join(", ")}`,
      );
    }

    if (!options.yes) {
      const tableList = typeNames.join(", ");
      const confirmation = await prompt.confirm({
        message: `This will truncate the following tables: ${tableList}. Continue?`,
        default: false,
      });
      if (!confirmation) {
        logger.info("Truncate cancelled.");
        return;
      }
    }

    for (const typeName of typeNames) {
      const namespace = typeNamespaceMap.get(typeName);
      if (!namespace) {
        continue;
      }

      await truncateSingleType(
        {
          workspaceId,
          namespaceName: namespace,
          typeName,
        },
        client,
      );
    }
  }
}

export const truncateCommand = defineAppCommand({
  name: "truncate",
  description: "Truncate (delete all records from) TailorDB tables.",
  args: v.strictObject({
    ...deploymentArgs,
    ...confirmationArgs,
    tables: arg(v.optional(v.array(v.string())), {
      positional: true,
      description: "Table names to truncate",
    }),
    all: arg(v.optional(v.boolean(), false), {
      alias: "a",
      description: "Truncate all tables in all owned namespaces (excludes external namespaces)",
    }),
    namespace: arg(v.optional(v.string()), {
      alias: "n",
      description: "Truncate all tables in specified namespace",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const tables = args.tables && args.tables.length > 0 ? args.tables : undefined;
    await $truncate({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      all: args.all,
      namespace: args.namespace,
      tables,
      yes: args.yes,
    });
  },
});
