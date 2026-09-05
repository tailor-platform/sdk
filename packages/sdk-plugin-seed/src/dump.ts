import {
  bundleSeedDumpScript,
  executeScript,
  initOperatorClient,
  loadAccessToken,
  loadSeedContext,
  loadWorkspaceId,
  show,
  deploymentArgs,
  defineAppCommand,
  logger,
  styles,
  arg,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";
import { selectEntities } from "./entities";
import { parseExecutionResult } from "./execution-result";
import { existingSeedDataFiles, writeSeedData } from "./jsonl";
import { topologicalSort } from "./topo-sort";
import type { OperatorClient, SeedData } from "@tailor-platform/sdk/cli";

/** Rows read per script execution, kept well inside the operator message size limit. */
const DEFAULT_PAGE_SIZE = 200;

/** Pages a single table can take before the run gives up rather than loop forever. */
const MAX_PAGES_PER_TABLE = 10_000;

interface DumpExecutionContext {
  operatorClient: OperatorClient;
  workspaceId: string;
  authNamespace: string;
  machineUserName: string;
}

interface DumpTableParams {
  execution: DumpExecutionContext;
  scriptCode: string;
  namespace: string;
  table: string;
  pageSize: number;
  omitFields: string[];
}

interface DumpPage {
  rows: Record<string, unknown>[];
  cursor: string | null;
}

/**
 * Drop the fields a seed row must not carry and the nulls that stand for "no
 * value", so a dumped row reads back the way a hand-written one does.
 * @param row - Row as the table returned it
 * @param omitFields - Fields the platform assigns rather than the seed row
 * @returns The row reduced to the fields seed data carries
 */
function toSeedRow(row: Record<string, unknown>, omitFields: string[]): SeedData[string][number] {
  const seedRow: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(row)) {
    if (omitFields.includes(field) || value === null || value === undefined) continue;
    seedRow[field] = value;
  }
  return seedRow as SeedData[string][number];
}

/**
 * Read one page of a table through the bundled dump script.
 * @param params - Execution context, script, and the table to read
 * @param after - Id to page after, or null for the first page
 * @returns The page's rows and the cursor for the next page
 */
async function dumpPage(params: DumpTableParams, after: string | null): Promise<DumpPage> {
  const { execution, scriptCode, namespace, table, pageSize } = params;

  const result = await executeScript({
    client: execution.operatorClient,
    workspaceId: execution.workspaceId,
    name: `seed-dump-${namespace}.ts`,
    code: scriptCode,
    arg: { table, limit: pageSize, after },
    invoker: {
      namespace: execution.authNamespace,
      machineUserName: execution.machineUserName,
    },
  });

  const { success, parsed, errors } = parseExecutionResult(result, "    ");
  if (!success) {
    throw new Error(`${table}: ${errors.join("; ")}`);
  }

  const rows = Array.isArray(parsed.rows) ? (parsed.rows as Record<string, unknown>[]) : [];
  const cursor = typeof parsed.cursor === "string" ? parsed.cursor : null;
  return { rows, cursor };
}

/**
 * Read every row of one table, paging by id until the table is exhausted.
 * @param params - Execution context, script, and the table to read
 * @returns The table's rows in seed row form
 */
async function dumpTable(params: DumpTableParams): Promise<SeedData[string]> {
  const rows: SeedData[string] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES_PER_TABLE; page++) {
    const result: DumpPage = await dumpPage(params, cursor);
    for (const row of result.rows) {
      rows.push(toSeedRow(row, params.omitFields));
    }
    if (result.cursor === null) return rows;
    cursor = result.cursor;
  }

  throw new Error(
    `${params.table}: stopped after ${String(MAX_PAGES_PER_TABLE)} pages. ` +
      "Increase --page-size, or narrow the dump to fewer tables.",
  );
}

export const seedDumpCommand = defineAppCommand({
  name: "dump",
  description: "Write the current TailorDB rows out as JSONL seed data.",
  notes:
    "The output is the same format `tailor seed apply` reads, so a dump taken before a change is " +
    "what restores the tables after it: `tailor seed apply --truncate` puts the dumped rows back. " +
    "Fields the platform assigns rather than the row — `serial` fields — are left out, as are " +
    "fields with no value, so the result reads back the way hand-written seed data does. " +
    "IdP `_User` records are never dumped: their credentials do not survive the round trip.",
  args: z.strictObject({
    ...deploymentArgs,
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description:
        "Machine user name for authentication (required unless machineUserName is configured in seedPlugin options)",
    }),
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Dump every table in the specified TailorDB namespace",
    }),
    out: arg(z.string().optional(), {
      alias: "o",
      description:
        "Directory to write the JSONL files into (default: the data directory under the seedPlugin distPath)",
      completion: { type: "directory" },
    }),
    force: arg(z.boolean().default(false), {
      alias: "f",
      description: "Overwrite JSONL files that already exist in the output directory",
    }),
    "page-size": arg(z.coerce.number().int().positive().default(DEFAULT_PAGE_SIZE), {
      description: "Rows read per request",
      completion: { type: "none" },
    }),
    entities: arg(z.array(z.string()).default([]), {
      positional: true,
      description: "Table names to dump (default: all)",
    }),
  }),
  run: async (args) => {
    if (args.entities.includes("_User")) {
      throw new Error(
        "IdP `_User` records cannot be dumped: the export would carry authentication data " +
          "that does not survive the round trip through seed JSONL. " +
          "Dump the TailorDB tables and keep the `_User` data under version control.",
      );
    }

    const context = await loadSeedContext({ configPath: args.config });

    const namespaceTables = Object.fromEntries(
      context.namespaces.map((ns) => [ns.namespace, ns.types]),
    );
    const selection = selectEntities({
      namespaceTables,
      hasIdpUser: false,
      namespace: args.namespace,
      entities: args.entities,
      skipIdp: false,
    });
    for (const warning of selection.warnings) {
      logger.warn(warning);
    }
    if (args.namespace) {
      logger.info(`Filtering by namespace: ${args.namespace}`);
    } else if (args.entities.length > 0) {
      logger.info(`Filtering by entities: ${(selection.entitiesToProcess ?? []).join(", ")}`);
    }

    if (!selection.hasEntitiesToProcess) {
      if (args.json) {
        logger.out({ success: true, dumped: {} });
      }
      logger.success("No dump targets found.");
      return;
    }

    const machineUserName = args["machine-user"] ?? context.machineUserName;
    if (!machineUserName) {
      throw new Error(
        "Machine user name is required. " +
          "Specify --machine-user <name> or configure machineUserName in seedPlugin options.",
      );
    }

    const dataDir = args.out
      ? path.resolve(process.cwd(), args.out)
      : path.join(context.distPath, "data");

    const namespacesToDump = args.namespace
      ? context.namespaces.filter((ns) => ns.namespace === args.namespace)
      : context.namespaces;
    const plan = namespacesToDump
      .map((ns) => ({
        config: ns,
        tables: topologicalSort(
          selection.entitiesToProcess
            ? ns.types.filter((type) => selection.entitiesToProcess?.includes(type))
            : ns.types,
          ns.dependencies,
        ),
      }))
      .filter((entry) => entry.tables.length > 0);

    if (!args.force) {
      const existing = existingSeedDataFiles(
        dataDir,
        plan.flatMap((entry) => entry.tables),
      );
      if (existing.length > 0) {
        throw new Error(
          `${String(existing.length)} JSONL file(s) already exist in ${dataDir}: ` +
            `${existing.join(", ")}. Pass --force to overwrite them, or --out to write elsewhere.`,
        );
      }
    }

    const appInfo = await show({
      configPath: args.config,
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });
    const execution: DumpExecutionContext = {
      operatorClient: await initOperatorClient(await loadAccessToken({ profile: args.profile })),
      workspaceId: await loadWorkspaceId({
        workspaceId: args["workspace-id"],
        profile: args.profile,
      }),
      authNamespace: appInfo.auth,
      machineUserName,
    };

    logger.info(`Dumping seed data to ${dataDir}...`);

    const dumped: Record<string, number> = {};
    try {
      for (const entry of plan) {
        const { namespace } = entry.config;
        logger.info(`  [${namespace}] Dumping ${String(entry.tables.length)} tables...`, {
          mode: "plain",
        });

        const bundled = await bundleSeedDumpScript(namespace, path.dirname(context.config.path));

        for (const table of entry.tables) {
          const rows = await dumpTable({
            execution,
            scriptCode: bundled.bundledCode,
            namespace,
            table,
            pageSize: args["page-size"],
            omitFields: entry.config.omitFields[table] ?? [],
          });
          writeSeedData(dataDir, table, rows);
          dumped[table] = rows.length;
          logger.log(styles.success(`    ✓ ${table}: ${String(rows.length)} rows`));
        }
      }
    } catch (error) {
      const writtenTables = Object.keys(dumped);
      if (writtenTables.length > 0) {
        logger.warn(
          `Dump failed after writing ${String(writtenTables.length)} table(s) to ${dataDir}: ` +
            `${writtenTables.join(", ")}. The rest of ${dataDir} still holds files from before ` +
            "this run (or none, for tables never dumped); re-run with --force once the failure " +
            "is fixed so every file reflects the same point in time.",
          { mode: "plain" },
        );
      }
      throw error;
    }

    logger.newline();
    if (args.json) {
      logger.out({ success: true, path: dataDir, dumped });
    }
    logger.success("Seed data dump completed successfully");
  },
});
