import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { create } from "@bufbuild/protobuf";
import {
  AuthInvokerSchema,
  type AuthInvoker,
  type MachineUser,
} from "@tailor-proto/tailor/v1/auth_resource_pb";
import { createPrompt } from "@toiroakr/read-multiline";
import * as path from "pathe";
import { parse as parseSql } from "pgsql-ast-parser";
import { arg } from "politty";
import { xdgConfig } from "xdg-basedir";
import { z } from "zod";
import { assertDefined } from "#src/utils/assert";
import { bundleQueryScript } from "../bundler/query/query-bundler";
import { deploymentArgs } from "../shared/args";
import { fetchMachineUserToken, initOperatorClient } from "../shared/client";
import { defineAppCommand } from "../shared/command";
import { extractAllNamespaces } from "../shared/config";
import { loadConfig, type LoadedConfig } from "../shared/config-loader";
import { loadAccessToken, loadMachineUserName, loadWorkspaceId } from "../shared/context";
import { getEditorCommand, openInEditor } from "../shared/editor";
import { isCLIError } from "../shared/errors";
import { logger } from "../shared/logger";
import { parseBoolean } from "../shared/parse-boolean";
import { executeScript } from "../shared/script-executor";
import { resolveTypeNamespaces } from "../shared/tailordb-namespace";
import { mapQueryExecutionError } from "./errors";
import { isGraphQLInputComplete } from "./graphql-repl";
import { isSqlInputComplete } from "./sql-repl";
import {
  extractColumnTemplate,
  extractTypeNamesFromSql,
  type ColumnSlot,
} from "./sql-type-extractor";
import { loadTypeFieldOrder } from "./type-field-order";
import { queryEngines, type QueryEngine } from "./types";
import type { Application } from "@tailor-proto/tailor/v1/application_resource_pb";

export type { QueryEngine } from "./types";

const queryEngineSchema = z.enum(queryEngines);
const queryBaseOptionsSchema = z.object({
  workspaceId: z.string().optional(),
  profile: z.string().optional(),
  configPath: z.string().optional(),
  engine: queryEngineSchema,
  machineUser: z.string().optional(),
});
const queryOptionsSchema = queryBaseOptionsSchema.extend({
  query: z.string(),
});

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

type QueryCommandInput =
  | {
      mode: "query";
      query: string;
    }
  | {
      mode: "repl";
    }
  | {
      mode: "abort";
    };

type ReplCommand = "quit" | "help" | "clear" | "unknown";

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
    return assertDefined(namespaces[0], "namespace missing");
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
    return assertDefined([...namespacesFromTypes][0], "namespace from types missing");
  }

  throw new Error(
    `Query references types from multiple namespaces: ${[...namespacesFromTypes].join(", ")}.`,
  );
}

async function loadOptions(options: QueryBaseOptions) {
  const result = queryBaseOptionsSchema.safeParse(options);

  if (!result.success) {
    throw new Error(
      assertDefined(result.error.issues[0], "validation error missing issues").message,
    );
  }

  const machineUser = await loadMachineUserName({
    machineUser: result.data.machineUser,
    profile: result.data.profile,
  });
  if (!machineUser) {
    throw new Error(
      "Machine user is required. Specify --machine-user, set TAILOR_PLATFORM_MACHINE_USER_NAME, or set a profile default with 'tailor-sdk profile update <profile> --machine-user <name>'.",
    );
  }

  const accessToken = await loadAccessToken({
    profile: result.data.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
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
    name: machineUser,
  });

  if (!machineUserResource) {
    throw new Error(`Machine user ${machineUser} not found.`);
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
  const queries = splitSqlStatements(args.query);
  const executed = await executeScript({
    client,
    workspaceId: args.workspaceId,
    name: `query-sql-${args.namespace}.js`,
    code: args.bundledCode,
    arg: JSON.stringify({
      namespace: args.namespace,
      queries,
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
 * Resolve query input mode from CLI args.
 * @param args - Query input flags
 * @param args.query - Direct query string
 * @param args.file - File path containing query text
 * @param args.edit - Open a query editor instead of REPL
 * @param args.engine - Query engine used to choose temp file extension
 * @returns Normalized input mode
 */
export async function resolveQueryCommandInput(args: {
  query?: string;
  file?: string;
  edit?: boolean;
  engine: QueryEngine;
}): Promise<QueryCommandInput> {
  if (args.query != null) {
    return {
      mode: "query",
      query: args.query,
    };
  }

  if (args.file != null) {
    return {
      mode: "query",
      query: await fs.readFile(args.file, "utf-8"),
    };
  }

  if (args.edit) {
    return await resolveEditedQueryInput(args.engine);
  }

  return {
    mode: "repl",
  };
}

async function resolveEditedQueryInput(engine: QueryEngine): Promise<QueryCommandInput> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Non-interactive terminals are not supported. Pass -q/--query or -f/--file to run a query.",
    );
  }

  const editor = getEditorCommand();

  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "tailor-query-"));
  const fileExtension = engine === "sql" ? "sql" : "graphql";
  const filePath = path.join(tempDir, `query.${fileExtension}`);
  const initialQuery = "";

  try {
    await fs.writeFile(filePath, initialQuery, "utf-8");
    try {
      await openInEditor(filePath, editor);
    } catch (error) {
      throw new Error(
        `Failed to open query editor "${editor}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const editedQuery = await fs.readFile(filePath, "utf-8");
    if (editedQuery.trim().length === 0 || editedQuery === initialQuery) {
      return {
        mode: "abort",
      };
    }

    return {
      mode: "query",
      query: editedQuery,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
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
    throw new Error(
      assertDefined(result.error.issues[0], "validation error missing issues").message,
    );
  }

  const executor = await prepareQueryExecutor(result.data);
  return await executor(result.data.query);
}

async function prepareQueryExecutor(
  options: QueryBaseOptions,
): Promise<(query: string) => Promise<QueryDispatchResult>> {
  const { client, workspaceId, config, application, machineUserResource, engine, namespaces } =
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
        case "sql": {
          namespace = await getNamespaceFromSqlQuery(workspaceId, queryString, client, namespaces);
          const result = await sqlQuery(client, invoker, {
            workspaceId,
            namespace,
            bundledCode,
            query: queryString,
          });
          return reorderSqlColumns(result, config, namespace, queryString);
        }
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
        machineUser: machineUserResource.name,
      });
    }
  };
}

/**
 * Resolve a backslash REPL command into its normalized action.
 * @param input - Raw user input
 * @returns Normalized REPL command, or null for non-command input
 */
export function resolveReplCommand(input: string): ReplCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("\\")) {
    return null;
  }

  if (trimmed === "\\q" || trimmed === "\\quit") {
    return "quit";
  }

  if (trimmed === "\\help" || trimmed === "\\h" || trimmed === "\\?") {
    return "help";
  }

  if (trimmed === "\\clear" || trimmed === "\\c") {
    return "clear";
  }

  return "unknown";
}

/**
 * Clear the interactive terminal screen and move the cursor to the top-left.
 */
function clearReplScreen(): void {
  process.stdout.write("\u001Bc");
}

function sanitizeHistoryScope(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getReplHistoryPath(
  engine: QueryEngine,
  profile: string | undefined,
  workspaceId: string | undefined,
): string | undefined {
  if (!xdgConfig) {
    return undefined;
  }
  const scope = [profile, workspaceId]
    .filter((value): value is string => Boolean(value))
    .map(sanitizeHistoryScope)
    .join("-");
  const engineSlug = engine === "sql" ? "sql" : "gql";
  const suffix = scope ? `-${scope}` : "";
  return path.join(xdgConfig, "tailor-platform", `query-history-${engineSlug}${suffix}.json`);
}

// TODO: Empty input and REPL commands (e.g. \help, \q) are treated as valid by
// the validator, so read-multiline saves them to history on submit. The library
// does not expose a history filter hook; a clean fix requires upstream support.
function createReplValidator(engine: QueryEngine): (value: string) => string | undefined {
  return (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") {
      return undefined;
    }
    if (resolveReplCommand(trimmed) !== null) {
      return undefined;
    }
    if (engine === "sql") {
      return isSqlInputComplete(value) ? undefined : "SQL statement is incomplete (missing ';').";
    }
    return isGraphQLInputComplete(value) ? undefined : "GraphQL document is incomplete.";
  };
}

async function runRepl(
  options: QueryBaseOptions & {
    json?: boolean;
    newlineOnEnter: boolean;
  },
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Non-interactive terminals are not supported. Pass -q/--query or -f/--file to run a query.",
    );
  }

  const execute = await prepareQueryExecutor(options);
  const historyPath = getReplHistoryPath(options.engine, options.profile, options.workspaceId);
  const validate = createReplValidator(options.engine);
  // Lazy-load the editor module so the `graphql` and `sql-highlight` libs are
  // only pulled in when the REPL is actually entered, not on every CLI startup.
  const { highlightSqlLine, highlightGraphqlLine, replTransform } = await import("./repl-editor");
  const highlight = options.engine === "sql" ? highlightSqlLine : highlightGraphqlLine;

  // NOTE: Each prompt() call reloads history from the file synchronously while the
  // previous call's async save may still be in-flight. In practice the race window
  // is only visible on fast paths (\help, \clear) whose entries are already non-ideal
  // for history (see createReplValidator TODO). Actual queries include network latency
  // that closes the window. A clean fix requires the library to export history utilities.
  const prompt = createPrompt({
    prefix: "",
    preferNewlineOnEnter: options.newlineOnEnter,
    validate,
    highlight,
    transform: replTransform,
    clearAfterSubmit: false,
    history: historyPath ? { filePath: historyPath, maxEntries: 100 } : [],
    helpFooter: { items: ["submit", "newline"], maxLines: 1 },
  });

  logger.info(`Entering ${options.engine.toUpperCase()} REPL mode.`);
  logger.info("Type \\help for usage, \\q to quit.");

  // loop exits when the user types the quit command
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    const [value, error] = await prompt(`${options.engine}> `);

    if (error?.kind === "cancel") {
      if (value.length === 0) {
        return;
      }
      continue;
    }

    if (error?.kind === "eof") {
      return;
    }

    const trimmed = value.trim();
    if (trimmed === "") {
      continue;
    }

    const command = resolveReplCommand(trimmed);
    if (command === "quit") {
      return;
    }
    if (command === "help") {
      printReplHelp(options.engine);
      continue;
    }
    if (command === "clear") {
      clearReplScreen();
      continue;
    }
    if (command === "unknown") {
      logger.warn(`Unknown command: ${trimmed}`);
      continue;
    }

    try {
      const result = await execute(trimmed);
      if (result.engine === "sql") {
        printSqlResult(result, { json: options.json });
      } else {
        printGqlResult(result, { json: options.json });
      }
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
}

function printReplHelp(engine: QueryEngine): void {
  logger.log("REPL commands:");
  logger.log("  \\help, \\h, \\?              Show this help");
  logger.log("  \\q, \\quit                  Exit REPL");
  logger.log("  \\clear, \\c                 Clear the screen");
  logger.log("");
  logger.log("Key bindings (see footer for terminal-specific submit/newline keys):");
  logger.log("  Ctrl+J                     Insert newline (always available)");
  logger.log("  Ctrl+C                     Cancel current input");
  logger.log("  Ctrl+D                     Exit REPL (on empty input)");
  logger.log("  Ctrl+Z / Ctrl+Y            Undo / Redo");
  logger.log("  Up/Down (first/last line)  Navigate history");
  logger.log("");
  logger.log("Editing aids:");
  logger.log("  Syntax highlighting        Enabled for the current engine");
  logger.log("  ( [ {                      Auto-inserts the matching closing bracket");
  logger.log("  Enter after open bracket   Adds one indent level and closes the block");
  logger.log("");
  logger.log(
    engine === "sql"
      ? "Input must end with ';' to submit."
      : "Input must be a complete GraphQL document to submit.",
  );
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

async function reorderSqlColumns(
  result: SQLQueryDispatchResult,
  config: LoadedConfig,
  namespace: string,
  sqlQuery: string,
): Promise<SQLQueryDispatchResult> {
  if (!isSQLExecutionResult(result.result) || result.result.rows.length === 0) {
    return result;
  }

  const template = extractColumnTemplate(sqlQuery);
  if (!template) {
    return result;
  }

  try {
    const fieldOrder = await loadTypeFieldOrder(config, namespace);
    const expectedOrder = buildExpectedColumnOrder(template, fieldOrder);
    if (expectedOrder.length === 0) {
      return result;
    }

    const orderedRows = result.result.rows.map((row) => reorderRowByTemplate(row, expectedOrder));

    return {
      ...result,
      result: {
        ...result.result,
        rows: orderedRows,
      },
    };
  } catch {
    return result;
  }
}

const SYSTEM_FIELD_ORDER = ["id"];

function buildExpectedColumnOrder(
  template: ColumnSlot[],
  fieldOrder: Map<string, string[]>,
): string[] {
  const order: string[] = [];

  for (const slot of template) {
    if (slot.type === "explicit") {
      order.push(slot.name);
    } else {
      for (const typeName of slot.typeNames) {
        order.push(...SYSTEM_FIELD_ORDER);
        order.push(...(fieldOrder.get(typeName) ?? []));
      }
    }
  }

  return order;
}

function reorderRowByTemplate(row: SQLResultRow, expectedOrder: string[]): SQLResultRow {
  const ordered: SQLResultRow = {};
  const rowKeys = new Set(Object.keys(row));

  // Build case-insensitive lookup: lowercased key → original key in row.
  // pgsql-ast-parser lowercases unquoted identifiers (PostgreSQL standard),
  // but TailorDB preserves the original case, so we need case-insensitive matching.
  const lowerToOriginal = new Map<string, string>();
  for (const key of rowKeys) {
    lowerToOriginal.set(key.toLowerCase(), key);
  }

  for (const key of expectedOrder) {
    const original = lowerToOriginal.get(key.toLowerCase());
    if (original != null && rowKeys.has(original)) {
      ordered[original] = row[original];
      rowKeys.delete(original);
      lowerToOriginal.delete(key.toLowerCase());
    }
  }

  for (const key of rowKeys) {
    ordered[key] = row[key];
  }

  return ordered;
}

export const queryCommand = defineAppCommand({
  name: "query",
  description: "Run SQL/GraphQL query.",
  args: z
    .object({
      ...deploymentArgs,
      engine: arg(queryEngineSchema, {
        description: "Query engine (sql or gql)",
      }),
      query: arg(z.string().optional(), {
        alias: "q",
        description: "Query string to execute directly; omit to start REPL mode",
      }),
      file: arg(z.string().optional(), {
        alias: "f",
        description: "Read query string from file; omit to start REPL mode",
      }),
      edit: arg(z.boolean().default(false), {
        description: "Open a temporary file in your editor; omit to start REPL mode",
      }),
      "machine-user": arg(z.string().optional(), {
        alias: "m",
        hiddenAlias: "machineuser",
        description:
          "Machine user name for query execution. Falls back to the active profile's default machine user.",
        env: "TAILOR_PLATFORM_MACHINE_USER_NAME",
      }),
      "newline-on-enter": arg(z.boolean().optional(), {
        description:
          "REPL: when true, Enter inserts a newline and Shift+Enter submits. Use --no-newline-on-enter to swap.",
      }),
    })
    .superRefine((args, ctx) => {
      if (args.query != null && args.file != null) {
        ctx.addIssue({
          code: "custom",
          path: ["file"],
          message: "Pass either -q/--query or -f/--file, not both.",
        });
      }

      if (args.edit && args.query != null) {
        ctx.addIssue({
          code: "custom",
          path: ["edit"],
          message: "Pass only one of --edit, -q/--query, or -f/--file.",
        });
      }

      if (args.edit && args.file != null) {
        ctx.addIssue({
          code: "custom",
          path: ["edit"],
          message: "Pass only one of --edit, -q/--query, or -f/--file.",
        });
      }
    })
    .strict(),
  run: async (args) => {
    const mode = await resolveQueryCommandInput({
      query: args.query,
      file: args.file,
      edit: args.edit,
      engine: args.engine,
    });

    const sharedOptions: QueryBaseOptions = {
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      engine: args.engine,
      machineUser: args["machine-user"],
    };

    if (mode.mode === "abort") {
      logger.info("Editor closed without a query. Nothing was executed.");
      return;
    }

    if (mode.mode === "repl") {
      const newlineOnEnter =
        args["newline-on-enter"] ??
        parseBoolean(process.env.TAILOR_PLATFORM_QUERY_NEWLINE_ON_ENTER) ??
        true;
      await runRepl({
        ...sharedOptions,
        json: args.json,
        newlineOnEnter,
      });
      return;
    }

    const directQuery = mode.query;

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
  },
});

function isSQLExecutionResult(value: unknown): value is SQLExecutionResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SQLExecutionResult>;
  return Array.isArray(candidate.rows) && typeof candidate.rowCount === "number";
}

function printSingleSqlResult(
  execResult: SQLExecutionResult,
  options: { json?: boolean } = {},
): void {
  if (execResult.rows.length === 0) {
    if (options.json) {
      logger.out({ results: [], rowCount: 0 });
      return;
    }
    logger.info("No rows returned.");
    return;
  }

  if (options.json) {
    logger.out({ results: execResult.rows, rowCount: execResult.rowCount });
    return;
  }

  logger.out(execResult.rows, { showNull: true });
  logger.out(`rows: ${execResult.rowCount}`);
}

function splitSqlStatements(query: string): string[] {
  const statements = parseSql(query, { locationTracking: true });
  // Extract original SQL text using AST location info instead of re-serializing
  // to preserve the user's original casing and syntax.
  // _location.end is unreliable for INSERT/UPDATE statements (https://github.com/oguimbal/pgsql-ast-parser/issues/135),
  // so we use the next statement's start (or end of string) as the boundary.
  return statements.map((s, i) => {
    const start = assertDefined(s._location, "SQL statement location missing").start;
    const nextStmt = statements[i + 1];
    const end =
      nextStmt !== undefined
        ? assertDefined(nextStmt._location, "SQL statement location missing").start
        : query.length;
    return query.substring(start, end);
  });
}

function isSQLExecutionResultArray(value: unknown): value is SQLExecutionResult[] {
  return Array.isArray(value) && value.length > 0 && value.every(isSQLExecutionResult);
}

function printSqlResult(result: SQLQueryDispatchResult, options: { json?: boolean } = {}): void {
  if (isSQLExecutionResultArray(result.result)) {
    if (options.json) {
      logger.out(result.result.map((r) => ({ results: r.rows, rowCount: r.rowCount })));
      return;
    }
    const queries = splitSqlStatements(result.query);
    for (let i = 0; i < result.result.length; i++) {
      if (i > 0) logger.log("");
      logger.info(queries[i] ?? `Statement ${i + 1}`);
      printSingleSqlResult(
        assertDefined(result.result[i], `SQL result at index ${i} missing`),
        options,
      );
    }
    return;
  }

  if (isSQLExecutionResult(result.result)) {
    printSingleSqlResult(result.result, options);
    return;
  }

  logger.out({
    engine: result.engine,
    query: result.query,
    result: result.result,
  });
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
