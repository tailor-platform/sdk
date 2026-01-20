import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";

export interface TruncateOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  all?: boolean;
  namespace?: string;
  types?: string[];
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

  logger.success(`Truncated type "${options.typeName}" in namespace "${options.namespaceName}"`);
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

  logger.success(`Truncated all types in namespace "${namespaceName}"`);
}

async function getAllNamespaces(configPath?: string): Promise<string[]> {
  const { config } = await loadConfig(configPath);
  const namespaces = new Set<string>();

  // Collect namespace names from db configuration
  if (config.db) {
    for (const [namespaceName] of Object.entries(config.db)) {
      namespaces.add(namespaceName);
    }
  }

  return Array.from(namespaces);
}

async function getTypeNamespace(
  workspaceId: string,
  typeName: string,
  client: Awaited<ReturnType<typeof initOperatorClient>>,
  configPath?: string,
): Promise<string | null> {
  const namespaces = await getAllNamespaces(configPath);

  // Try to find the type in each namespace
  for (const namespace of namespaces) {
    try {
      const { tailordbTypes } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName: namespace,
      });

      if (tailordbTypes.some((type) => type.name === typeName)) {
        return namespace;
      }
    } catch {
      // Continue to next namespace if error occurs
      continue;
    }
  }

  return null;
}

/**
 * Truncate TailorDB data based on the given options.
 * @param [options] - Truncate options (all, namespace, or types)
 * @returns Promise that resolves when truncation completes
 */
export async function truncate(options?: TruncateOptions): Promise<void> {
  // Load and validate options
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  // Validate arguments
  const hasTypes = options?.types && options.types.length > 0;
  const hasNamespace = !!options?.namespace;
  const hasAll = !!options?.all;

  // All options are mutually exclusive
  const optionCount = [hasAll, hasNamespace, hasTypes].filter(Boolean).length;
  if (optionCount === 0) {
    throw new Error("Please specify one of: --all, --namespace <name>, or type names");
  }
  if (optionCount > 1) {
    throw new Error(
      "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.",
    );
  }

  // Validate config and get namespaces before confirmation
  const namespaces = await getAllNamespaces(options?.configPath);

  // Handle --all flag
  if (hasAll) {
    if (namespaces.length === 0) {
      logger.warn("No namespaces found in config file.");
      return;
    }

    if (!options?.yes) {
      const namespaceList = namespaces.join(", ");
      const confirmation = await logger.prompt(
        `This will truncate ALL tables in the following namespaces: ${namespaceList}. Continue? (yes/no)`,
        {
          type: "confirm",
          initial: false,
        },
      );
      if (!confirmation) {
        logger.info("Truncate cancelled.");
        return;
      }
    }

    for (const namespace of namespaces) {
      await truncateNamespace(workspaceId, namespace, client);
    }
    logger.success("Truncated all tables in all namespaces");
    return;
  }

  // Handle --namespace flag
  if (hasNamespace && options?.namespace) {
    const namespace = options.namespace;

    // Validate namespace exists in config
    if (!namespaces.includes(namespace)) {
      throw new Error(
        `Namespace "${namespace}" not found in config. Available namespaces: ${namespaces.join(", ")}`,
      );
    }

    if (!options.yes) {
      const confirmation = await logger.prompt(
        `This will truncate ALL tables in namespace "${namespace}". Continue? (yes/no)`,
        {
          type: "confirm",
          initial: false,
        },
      );
      if (!confirmation) {
        logger.info("Truncate cancelled.");
        return;
      }
    }

    await truncateNamespace(workspaceId, namespace, client);
    return;
  }

  // Handle specific types
  if (hasTypes && options?.types) {
    const typeNames = options.types;

    // Validate all types exist and get their namespaces before confirmation
    const typeNamespaceMap = new Map<string, string>();
    const notFoundTypes: string[] = [];

    for (const typeName of typeNames) {
      const namespace = await getTypeNamespace(workspaceId, typeName, client, options.configPath);

      if (namespace) {
        typeNamespaceMap.set(typeName, namespace);
      } else {
        notFoundTypes.push(typeName);
      }
    }

    if (notFoundTypes.length > 0) {
      throw new Error(
        `The following types were not found in any namespace: ${notFoundTypes.join(", ")}`,
      );
    }

    if (!options.yes) {
      const typeList = typeNames.join(", ");
      const confirmation = await logger.prompt(
        `This will truncate the following types: ${typeList}. Continue? (yes/no)`,
        {
          type: "confirm",
          initial: false,
        },
      );
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

export const truncateCommand = defineCommand({
  meta: {
    name: "truncate",
    description: "Truncate TailorDB tables",
  },
  args: {
    ...commonArgs,
    types: {
      type: "positional",
      description: "Type names to truncate",
      required: false,
    },
    all: {
      type: "boolean",
      description: "Truncate all tables in all namespaces",
      default: false,
      alias: "a",
    },
    namespace: {
      type: "string",
      description: "Truncate all tables in specified namespace",
      alias: "n",
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompt",
      alias: "y",
      default: false,
    },
    ...deploymentArgs,
  },
  run: withCommonArgs(async (args) => {
    // Get type names from rest arguments (_)
    const types = args._.length > 0 ? args._.map((arg) => String(arg)).filter(Boolean) : undefined;
    await truncate({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      all: args.all,
      namespace: args.namespace,
      types,
      yes: args.yes,
    });
  }),
});
