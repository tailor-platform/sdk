import { create } from "@bufbuild/protobuf";
import {
  AuthInvokerSchema,
  type AuthInvoker,
  type MachineUser,
} from "@tailor-proto/tailor/v1/auth_resource_pb";
import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, deploymentArgs, withCommonArgs } from "../args";
import { bundleQueryScript } from "../bundler/query/query-bundler";
import { fetchMachineUserToken, initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { executeScript } from "../utils/script-executor";
import { mapQueryExecutionError } from "./errors";
import type { Application } from "@tailor-proto/tailor/v1/application_resource_pb";

const queryEngineSchema = z.enum(["sql", "gql"]);
const queryOptionsSchema = z.object({
  workspaceId: z.string().optional(),
  profile: z.string().optional(),
  configPath: z.string().optional(),
  namespace: z.string(),
  engine: queryEngineSchema,
  query: z.string(),
  machineUser: z.string(),
});

export type QueryEngine = z.infer<typeof queryEngineSchema>;
type QueryOptions = z.input<typeof queryOptionsSchema>;
type Client = Awaited<ReturnType<typeof initOperatorClient>>;

type QueryDispatchResult = {
  engine: QueryEngine;
  namespace: string;
  query: string;
  result: unknown;
};

type SQLResultRow = Record<string, unknown>;
type SQLExecutionResult = {
  rows: SQLResultRow[];
  rowCount: number;
};

async function loadOptions(options: QueryOptions) {
  const result = queryOptionsSchema.safeParse(options);

  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: result.data.workspaceId,
    profile: result.data.profile,
  });
  const { config } = await loadConfig(options.configPath);
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

  return {
    client,
    workspaceId,
    config,
    application,
    machineUserResource,
    args: {
      profile: result.data.profile,
      namespace: result.data.namespace,
      engine: result.data.engine,
      query: result.data.query,
      machineUser: result.data.machineUser,
    },
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
    namespace: string;
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
    name: `query-gql-${args.namespace}.js`,
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
    namespace: args.namespace,
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
  const { client, workspaceId, application, machineUserResource, args } =
    await loadOptions(options);

  try {
    const bundledCode = await bundleQueryScript(options.engine);
    const invoker = create(AuthInvokerSchema, {
      namespace: application.authNamespace,
      machineUserName: args.machineUser,
    });

    switch (options.engine) {
      case "sql":
        return await sqlQuery(client, invoker, {
          workspaceId,
          namespace: args.namespace,
          bundledCode,
          query: args.query,
        });
      case "gql":
        return await gqlQuery(client, invoker, application, machineUserResource, {
          workspaceId,
          namespace: args.namespace,
          bundledCode,
          query: args.query,
        });
      default:
        throw new Error(`Unsupported query engine: ${options.engine satisfies never}`);
    }
  } catch (error) {
    throw mapQueryExecutionError({
      error,
      engine: args.engine,
      namespace: args.namespace,
      machineUser: args.machineUser,
    });
  }
}

export const queryCommand = defineCommand({
  name: "query",
  description: "Run SQL/GraphQL query.",
  args: z.object({
    ...commonArgs,
    ...deploymentArgs,
    engine: arg(queryEngineSchema, {
      description: "Query engine (sql or gql)",
    }),
    namespace: arg(z.string(), {
      alias: "n",
      description: "Namespace name",
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
      namespace: args.namespace,
      engine: args.engine,
      query: args.query,
      machineUser: args.machineuser,
    });

    printQueryResult(result);
  }),
});

function isSQLExecutionResult(value: unknown): value is SQLExecutionResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SQLExecutionResult>;
  return Array.isArray(candidate.rows) && typeof candidate.rowCount === "number";
}

function printQueryResult(result: QueryDispatchResult): void {
  if (result.engine === "sql" && isSQLExecutionResult(result.result)) {
    logger.out({
      engine: result.engine,
      namespace: result.namespace,
      query: result.query,
      rowCount: result.result.rowCount,
    });

    if (result.result.rows.length === 0) {
      logger.info("No rows returned.");
      return;
    }

    logger.out(result.result.rows, { showNull: true });
    return;
  }

  if (result.engine === "gql") {
    logger.out({
      engine: result.engine,
      namespace: result.namespace,
      query: result.query,
    });
    logger.out(JSON.stringify(result.result, null, 2));
    return;
  }

  logger.out({
    engine: result.engine,
    namespace: result.namespace,
    query: result.query,
    result: result.result,
  });
}
