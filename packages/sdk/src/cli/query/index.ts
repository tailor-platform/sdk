import { create } from "@bufbuild/protobuf";
import {
  AuthInvokerSchema,
  type AuthInvoker,
  type MachineUser,
} from "@tailor-proto/tailor/v1/auth_resource_pb";
import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../args";
import { bundleQueryScript } from "../bundler/query/query-bundler";
import { fetchMachineUserToken, initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { extractAllNamespaces } from "../utils/config";
import { logger } from "../utils/logger";
import { executeScript } from "../utils/script-executor";
import { resolveTypeNamespaces } from "../utils/tailordb-namespace";
import { mapQueryExecutionError } from "./errors";
import { extractTypeNamesFromSql } from "./sql-type-extractor";
import type { Application } from "@tailor-proto/tailor/v1/application_resource_pb";

const queryEngineSchema = z.enum(["sql", "gql"]);
const queryOptionsSchema = z.object({
  workspaceId: z.string().optional(),
  profile: z.string().optional(),
  configPath: z.string().optional(),
  engine: queryEngineSchema,
  query: z.string(),
  machineUser: z.string(),
});

export type QueryEngine = z.infer<typeof queryEngineSchema>;
type QueryOptions = z.input<typeof queryOptionsSchema>;
type Client = Awaited<ReturnType<typeof initOperatorClient>>;

type QueryDispatchResult = {
  engine: QueryEngine;
  query: string;
  result: unknown;
};

type SQLResultRow = Record<string, unknown>;
type SQLExecutionResult = {
  rows: SQLResultRow[];
  rowCount: number;
};

async function getNamespaceFromSqlQuery(
  workspaceId: string,
  query: string,
  client: Client,
  namespaces: string[],
): Promise<string> {
  if (namespaces.length === 0) {
    throw new Error("No namespaces found in configuration.");
  }

  const typeNames = extractTypeNamesFromSql(query);
  if (typeNames.length === 0) {
    if (namespaces.length === 1) {
      return namespaces[0];
    }

    throw new Error(
      `Could not infer namespace from query. Detected namespaces: ${namespaces.join(", ")}.`,
    );
  }

  const typeNamespaceMap = await resolveTypeNamespaces({
    workspaceId,
    namespaces,
    typeNames,
    client,
  });

  const notFoundTypes = typeNames.filter((typeName) => !typeNamespaceMap.has(typeName));
  if (notFoundTypes.length > 0) {
    throw new Error(`Could not find namespace for types in query: ${notFoundTypes.join(", ")}.`);
  }

  const namespacesFromTypes = new Set(typeNamespaceMap.values());
  if (namespacesFromTypes.size === 1) {
    return [...namespacesFromTypes][0];
  }

  throw new Error(
    `Query references types from multiple namespaces: ${[...namespacesFromTypes].join(", ")}.`,
  );
}

async function loadOptions(options: QueryOptions) {
  const result = queryOptionsSchema.safeParse(options);

  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: result.data.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: result.data.workspaceId,
    profile: result.data.profile,
  });
  const { config } = await loadConfig(options.configPath);
  const namespaces = extractAllNamespaces(config);
  const { application } = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });

  if (!application?.authNamespace) {
    throw new Error(`Application ${config.name} does not have an auth configuration.`);
  }

  const { machineUser: machineUserResource } = await client.getAuthMachineUser({
    workspaceId: workspaceId,
    authNamespace: application.authNamespace,
    name: result.data.machineUser,
  });

  if (!machineUserResource) {
    throw new Error(`Machine user ${result.data.machineUser} not found.`);
  }

  if (options.engine === "gql") {
    return {
      engine: options.engine,
      client,
      workspaceId,
      config,
      application,
      machineUserResource,
    };
  }

  const namespace = await getNamespaceFromSqlQuery(
    workspaceId,
    result.data.query,
    client,
    namespaces,
  );

  return {
    engine: options.engine,
    client,
    workspaceId,
    config,
    application,
    machineUserResource,
    namespace,
  };
}

async function sqlQuery(
  client: Client,
  invoker: AuthInvoker,
  args: {
    workspaceId: string;
    namespace: string;
    bundledCode: string;
    query: string;
  },
) {
  const executed = await executeScript({
    client,
    workspaceId: args.workspaceId,
    name: `query-sql-${args.namespace}.js`,
    code: args.bundledCode,
    arg: JSON.stringify({
      namespace: args.namespace,
      query: args.query,
    }),
    invoker,
  });

  if (!executed.success) {
    throw new Error(executed.error);
  }

  return {
    engine: "sql" as const,
    namespace: args.namespace,
    query: args.query,
    result: parseExecutionResult(executed.result),
  };
}

async function gqlQuery(
  client: Client,
  invoker: AuthInvoker,
  application: Application,
  machineUser: MachineUser,
  args: {
    workspaceId: string;
    bundledCode: string;
    query: string;
  },
) {
  const { access_token: accessToken } = await fetchMachineUserToken(
    application.url,
    machineUser.clientId,
    machineUser.clientSecret,
  );

  const executed = await executeScript({
    client,
    workspaceId: args.workspaceId,
    name: `query-gql.js`,
    code: args.bundledCode,
    arg: JSON.stringify({
      endpoint: `${application.url}/query`,
      accessToken,
      query: args.query,
    }),
    invoker,
  });

  if (!executed.success) {
    throw new Error(executed.error);
  }

  return {
    engine: "gql" as const,
    query: args.query,
    result: parseExecutionResult(executed.result),
  };
}

function parseExecutionResult(result: string): unknown {
  if (!result) {
    return null;
  }

  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

/**
 * Dispatch query execution.
 * @param options - Query command options
 * @returns Dispatch result
 */
export async function query(options: QueryOptions) {
  const { client, workspaceId, application, machineUserResource, engine, namespace } =
    await loadOptions(options);

  try {
    const bundledCode = await bundleQueryScript(engine);
    const invoker = create(AuthInvokerSchema, {
      namespace: application.authNamespace,
      machineUserName: machineUserResource.name,
    });

    switch (engine) {
      case "sql":
        return await sqlQuery(client, invoker, {
          workspaceId,
          namespace,
          bundledCode,
          query: options.query,
        });
      case "gql":
        return await gqlQuery(client, invoker, application, machineUserResource, {
          workspaceId,
          bundledCode,
          query: options.query,
        });
      default:
        throw new Error(`Unsupported query engine: ${engine satisfies never}`);
    }
  } catch (error) {
    throw mapQueryExecutionError({
      error,
      engine,
      namespace,
      machineUser: options.machineUser,
    });
  }
}

export const queryCommand = defineCommand({
  name: "query",
  description: "Run SQL/GraphQL query.",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...deploymentArgs,
    engine: arg(queryEngineSchema, {
      description: "Query engine (sql or gql)",
    }),
    query: arg(z.string(), {
      alias: "q",
      description: "Query string to execute directly",
    }),
    machineuser: arg(z.string(), {
      alias: "m",
      description: "Machine user name for query execution",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const result = await query({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      engine: args.engine,
      query: args.query,
      machineUser: args.machineuser,
    });

    printQueryResult(result, { json: args.json });
  }),
});

function isSQLExecutionResult(value: unknown): value is SQLExecutionResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SQLExecutionResult>;
  return Array.isArray(candidate.rows) && typeof candidate.rowCount === "number";
}

function printQueryResult(result: QueryDispatchResult, options: { json?: boolean } = {}): void {
  if (result.engine === "sql" && isSQLExecutionResult(result.result)) {
    if (result.result.rows.length === 0) {
      if (options.json) {
        logger.out({
          results: [],
          rowCount: 0,
        });
      }
      logger.info("No rows returned.");
      return;
    }

    if (options.json) {
      logger.out({
        results: result.result.rows,
        rowCount: result.result.rowCount,
      });
      return;
    }
    logger.out(result.result.rows, { showNull: true });
    logger.out(`rows: ${result.result.rowCount}`);
    return;
  }

  if (result.engine === "gql") {
    if (options.json) {
      logger.out({
        result: result.result,
      });
      return;
    }
    logger.out(JSON.stringify(result.result, null, 2));
    return;
  }

  logger.out({
    engine: result.engine,
    query: result.query,
    result: result.result,
  });
}
