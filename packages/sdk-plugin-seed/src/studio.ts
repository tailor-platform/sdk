import { readdir, readFile } from "node:fs/promises";
import {
  loadSeedContext,
  configArg,
  defineAppCommand,
  logger,
  arg,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";
import { assertSeedDataDirectory } from "./jsonl";

type SeedModule = typeof import("@tailor-platform/sdk/seed");
type SeedStudio = Awaited<ReturnType<SeedModule["startSeedStudio"]>>;

const stopStudio = new AbortController();
let studioStart: Promise<SeedStudio> | undefined;

async function listTablesWithoutRows(dataDir: string): Promise<string[]> {
  const files = (await readdir(dataDir)).filter((file) => file.endsWith(".jsonl")).toSorted();
  const empty: string[] = [];
  for (const file of files) {
    if ((await readFile(path.join(dataDir, file), "utf-8")).trim() === "") {
      empty.push(path.basename(file, ".jsonl"));
    }
  }
  return empty;
}

export const seedStudioCommand = defineAppCommand({
  name: "studio",
  description: "Browse and edit JSONL seed data in a local web UI.",
  notes:
    "Changes stay pending until you save them, and a save is checked against the same schema files " +
    "`tailor seed validate` uses: a value they reject is not written. A save writes the fields you " +
    "entered plus the `id` generated for a new row, and leaves the values the table fills in on " +
    "create, such as `createdAt`, to the table. Each save is checked on its own, so run " +
    "`tailor seed validate` before `tailor seed apply`. A table whose JSONL file has no rows yet is " +
    "not shown until it has one. Stop the studio with Ctrl+C.",
  args: z.strictObject({
    ...configArg,
    port: arg(z.coerce.number().int().min(0).max(65_535).optional(), {
      description: "Port to serve the studio on; 0 picks a free one (default: 4848)",
      completion: { type: "none" },
    }),
    open: arg(z.boolean().default(false), {
      description: "Open the studio in the default browser",
    }),
    path: arg(z.string().optional(), {
      positional: true,
      description:
        "Data directory to open (default: the data directory under the seedPlugin distPath)",
      completion: { type: "directory" },
    }),
  }),
  run: async (args) => {
    // The plugin's peer range still admits SDK releases that predate the studio.
    const { startSeedStudio } = (await import("@tailor-platform/sdk/seed")) as Partial<SeedModule>;
    if (typeof startSeedStudio !== "function") {
      throw new Error(
        "`tailor seed studio` needs a newer @tailor-platform/sdk. Upgrade it to the latest release.",
      );
    }

    let dataDir: string;
    if (args.path) {
      dataDir = path.resolve(process.cwd(), args.path);
    } else {
      const context = await loadSeedContext({ configPath: args.config });
      dataDir = path.join(context.distPath, "data");
      assertSeedDataDirectory(dataDir);
    }

    studioStart = startSeedStudio({
      dataDir,
      port: args.port,
      open: args.open,
      signal: stopStudio.signal,
    });
    const studio = await studioStart;
    const tablesWithoutRows = await listTablesWithoutRows(dataDir);
    if (args.json) {
      logger.out({ url: studio.url, dataDir, tablesWithoutRows });
    } else if (tablesWithoutRows.length > 0) {
      logger.info(`Not shown until their JSONL file has a row: ${tablesWithoutRows.join(", ")}`);
    }
    await studio.closed;
  },
  cleanup: async () => {
    stopStudio.abort();
    await studioStart?.then((studio) => studio.closed).catch(() => {});
  },
});
