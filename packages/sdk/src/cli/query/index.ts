import { createInterface } from "node:readline/promises";
import { create } from "@bufbuild/protobuf";
import {
  AuthInvokerSchema,
  type AuthInvoker,
  type MachineUser,
} from "@tailor-proto/tailor/v1/auth_resource_pb";
import { arg, defineCommand } from "politty";
import { z } from "zod";
import { bundleQueryScript } from "../bundler/query/query-bundler";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../shared/args";
import { fetchMachineUserToken, initOperatorClient } from "../shared/client";
import { extractAllNamespaces } from "../shared/config";
import { loadConfig } from "../shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "../shared/context";
import { isCLIError } from "../shared/errors";
import { logger } from "../shared/logger";
import { executeScript } from "../shared/script-executor";
import { resolveTypeNamespaces } from "../shared/tailordb-namespace";
import { mapQueryExecutionError } from "./errors";
import { extractTypeNamesFromSql } from "./sql-type-extractor";
import type { Application } from "@tailor-proto/tailor/v1/application_resource_pb";

const queryEngineSchema = z.enum(["sql", "gql"]);
const queryBaseOptionsSchema = z.object({
  workspaceId: z.string().optional(),
  profile: z.string().optional(),
  configPath: z.string().optional(),
  engine: queryEngineSchema,
  machineUser: z.string(),
});
const queryOptionsSchema = queryBaseOptionsSchema.extend({
  query: z.string(),
});
const queryCommandInputSchema = z
  .object({
    query: z.string().optional(),
    repl: z.boolean(),
  })
  .superRefine((input, context) => {
    if (input.repl && input.query !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["query"],
        message: "--repl and --query cannot be used together.",
      });
      return;
    }

    if (!input.repl && (input.query === undefined || input.query.trim().length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["query"],
        message: "--query is required unless --repl is set.",
      });
    }
  });

export type QueryEngine = z.infer<typeof queryEngineSchema>;
type QueryOptions = z.input<typeof queryOptionsSchema>;
type QueryBaseOptions = z.input<typeof queryBaseOptionsSchema>;
type QuerySharedOptions = Omit<QueryOptions, "engine">;
type Client = Awaited<ReturnType<typeof initOperatorClient>>;

type SQLQueryDispatchResult = {
  engine: "sql";
  namespace: string;
  query: string;
  result: unknown;
};

type GQLQueryDispatchResult = {
  engine: "gql";
  query: string;
  result: unknown;
};

type QueryDispatchResult = SQLQueryDispatchResult | GQLQueryDispatchResult;

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

  if (namespaces.length === 1) {
    return namespaces[0];
  }

  const typeNames = extractTypeNamesFromSql(query);
  if (typeNames.length === 0) {
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

async function loadOptions(options: QueryBaseOptions) {
  const result = queryBaseOptionsSchema.safeParse(options);

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

  return {
    engine: result.data.engine,
    client,
    workspaceId,
    config,
    application,
    machineUserResource,
    namespaces,
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
): Promise<SQLQueryDispatchResult> {
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
): Promise<GQLQueryDispatchResult> {
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
export async function query(options: QueryOptions): Promise<QueryDispatchResult> {
  const result = queryOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  const executor = await prepareQueryExecutor(result.data);
  return await executor(result.data.query);
}

async function prepareQueryExecutor(
  options: QueryBaseOptions,
): Promise<(query: string) => Promise<QueryDispatchResult>> {
  const { client, workspaceId, application, machineUserResource, engine, namespaces } =
    await loadOptions(options);
  const bundledCode = await bundleQueryScript(engine);
  const invoker = create(AuthInvokerSchema, {
    namespace: application.authNamespace,
    machineUserName: machineUserResource.name,
  });

  return async (queryString: string) => {
    let namespace: string | undefined;

    try {
      switch (engine) {
        case "sql":
          namespace = await getNamespaceFromSqlQuery(workspaceId, queryString, client, namespaces);
          return await sqlQuery(client, invoker, {
            workspaceId,
            namespace,
            bundledCode,
            query: queryString,
          });
        case "gql":
          return await gqlQuery(client, invoker, application, machineUserResource, {
            workspaceId,
            bundledCode,
            query: queryString,
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
  };
}

function isReadlineTerminationError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }
  return error.code === "ABORT_ERR" || error.code === "ERR_USE_AFTER_CLOSE";
}

async function runRepl(
  options: QueryBaseOptions & {
    json?: boolean;
  },
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("--repl requires an interactive terminal.");
  }

  const execute = await prepareQueryExecutor(options);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  logger.info(`Entering ${options.engine.toUpperCase()} REPL mode.`);
  logger.info("Type .help for usage, .exit to quit.");

  const lines: string[] = [];
  let emptyLineCount = 0;

  try {
    while (true) {
      const prompt = lines.length === 0 ? `${options.engine}> ` : " ";
      let line: string;
      try {
        line = await rl.question(prompt);
      } catch (error) {
        if (isReadlineTerminationError(error)) {
          return;
        }
        throw error;
      }
      const trimmed = line.trim();

      if (lines.length === 0 && trimmed.startsWith(".")) {
        if (trimmed === ".exit") {
          return;
        }
        if (trimmed === ".help") {
          printReplHelp(options.engine);
          continue;
        }
        logger.warn(`Unknown command: ${trimmed}`);
        continue;
      }

      lines.push(line);

      if (options.engine === "sql") {
        if (!trimmed.endsWith(";")) {
          continue;
        }
      } else {
        if (trimmed === "") {
          emptyLineCount += 1;
        } else {
          emptyLineCount = 0;
        }
        if (emptyLineCount < 2) {
          continue;
        }
      }

      const statement = getReplStatement(lines, options.engine);
      lines.length = 0;
      emptyLineCount = 0;

      if (statement.length === 0) {
        continue;
      }

      try {
        if (options.engine === "sql") {
          const result = await execute(statement);
          if (result.engine !== "sql") {
            throw new Error(`Expected sql engine result but got: ${result.engine}`);
          }
          printSqlResult(result, { json: options.json });
          continue;
        }

        const result = await execute(statement);
        if (result.engine !== "gql") {
          throw new Error(`Expected gql engine result but got: ${result.engine}`);
        }
        printGqlResult(result, { json: options.json });
      } catch (error) {
        if (isCLIError(error)) {
          logger.log(error.format());
          continue;
        }
        if (error instanceof Error) {
          logger.error(error.message);
          continue;
        }
        logger.error(String(error));
      }
    }
  } finally {
    rl.close();
  }
}

function getReplStatement(lines: string[], engine: QueryEngine): string {
  if (engine === "sql") {
    return lines.join("\n").trim();
  }

  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end).join("\n").trim();
}

function printReplHelp(engine: QueryEngine): void {
  logger.log("REPL commands:");
  logger.log("  .help  Show this help");
  logger.log("  .exit  Exit REPL");
  if (engine === "sql") {
    logger.log("SQL execution: statement ending with ';' runs immediately.");
    return;
  }
  logger.log("GraphQL execution: submit two consecutive empty lines to run.");
}

/**
 * Execute SQL query directly.
 * @param options - Shared query options
 * @returns SQL query result
 */
async function querySql(options: QuerySharedOptions): Promise<SQLQueryDispatchResult> {
  const result = await query({
    ...options,
    engine: "sql",
  });

  if (result.engine !== "sql") {
    throw new Error(`Expected sql engine result but got: ${result.engine}`);
  }

  return result;
}

/**
 * Execute GraphQL query directly.
 * @param options - Shared query options
 * @returns GraphQL query result
 */
async function queryGql(options: QuerySharedOptions): Promise<GQLQueryDispatchResult> {
  const result = await query({
    ...options,
    engine: "gql",
  });

  if (result.engine !== "gql") {
    throw new Error(`Expected gql engine result but got: ${result.engine}`);
  }

  return result;
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
    query: arg(z.string().optional(), {
      alias: "q",
      description: "Query string to execute directly",
    }),
    repl: arg(z.boolean().default(false), {
      description: "Run query command in interactive REPL mode",
    }),
    machineuser: arg(z.string(), {
      alias: "m",
      description: "Machine user name for query execution",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const mode = queryCommandInputSchema.safeParse({
      query: args.query,
      repl: args.repl,
    });
    if (!mode.success) {
      throw new Error(mode.error.issues[0].message);
    }

    const sharedOptions: QueryBaseOptions = {
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      engine: args.engine,
      machineUser: args.machineuser,
    };

    if (mode.data.repl) {
      await runRepl({
        ...sharedOptions,
        json: args.json,
      });
      return;
    }

    const directQuery = mode.data.query;
    if (directQuery === undefined) {
      throw new Error("--query is required unless --repl is set.");
    }

    if (args.engine === "sql") {
      const result = await querySql({
        ...sharedOptions,
        query: directQuery,
      });
      printSqlResult(result, { json: args.json });
      return;
    }

    const result = await queryGql({
      ...sharedOptions,
      query: directQuery,
    });
    printGqlResult(result, { json: args.json });
  }),
});

function isSQLExecutionResult(value: unknown): value is SQLExecutionResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SQLExecutionResult>;
  return Array.isArray(candidate.rows) && typeof candidate.rowCount === "number";
}

function printSqlResult(result: SQLQueryDispatchResult, options: { json?: boolean } = {}): void {
  if (!isSQLExecutionResult(result.result)) {
    logger.out({
      engine: result.engine,
      query: result.query,
      result: result.result,
    });
    return;
  }

  if (result.result.rows.length === 0) {
    if (options.json) {
      logger.out({
        results: [],
        rowCount: 0,
      });
      return;
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
}

function printGqlResult(result: GQLQueryDispatchResult, options: { json?: boolean } = {}): void {
  if (options.json) {
    logger.out({
      result: result.result,
    });
    return;
  }

  logger.out(JSON.stringify(result.result, null, 2));
}
