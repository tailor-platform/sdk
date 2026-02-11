import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, deploymentArgs, withCommonArgs } from "./args";
import { logger } from "./utils/logger";

const queryEngineSchema = z.enum(["sql", "gql"]);
export type QueryEngine = z.infer<typeof queryEngineSchema>;

const queryOptionsSchema = z.object({
  workspaceId: z.string().optional(),
  profile: z.string().optional(),
  configPath: z.string().optional(),
  namespace: z.string().min(1, { message: "namespace is required" }),
  engine: queryEngineSchema,
});

export type QueryOptions = z.input<typeof queryOptionsSchema>;

export interface QueryDispatchResult {
  engine: QueryEngine;
  namespace: string;
}

async function dispatchSql(namespace: string): Promise<QueryDispatchResult> {
  return {
    engine: "sql",
    namespace,
  };
}

async function dispatchGql(namespace: string): Promise<QueryDispatchResult> {
  return {
    engine: "gql",
    namespace,
  };
}

/**
 * Dispatch query execution by engine and namespace.
 * Story 1 scope: command entry + engine dispatch only.
 * @param options - Query command options
 * @returns Dispatch result
 */
export async function query(options: QueryOptions): Promise<QueryDispatchResult> {
  const parsed = queryOptionsSchema.parse(options);

  switch (parsed.engine) {
    case "sql":
      return await dispatchSql(parsed.namespace);
    case "gql":
      return await dispatchGql(parsed.namespace);
    default:
      throw new Error(`Unsupported engine: ${parsed.engine satisfies never}`);
  }
}

export const queryCommand = defineCommand({
  name: "query",
  description: "Dispatch SQL/GraphQL query execution by engine.",
  args: z.object({
    ...commonArgs,
    ...deploymentArgs,
    engine: arg(queryEngineSchema, {
      description: "Query engine (sql or gql)",
    }),
    namespace: arg(z.string().min(1, { message: "namespace is required" }), {
      alias: "n",
      description: "Namespace name",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const result = await query({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      namespace: args.namespace,
      engine: args.engine,
    });

    logger.out({
      status: "dispatched",
      engine: result.engine,
      namespace: result.namespace,
    });
  }),
});
