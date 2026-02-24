import * as fs from "node:fs";
import { parseEnv } from "node:util";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger, styles } from "../utils/logger";
import { fileArgs, vaultArgs } from "./args";
import { secretList } from "./list";

interface ImportResult {
  name: string;
  action: "created" | "updated" | "failed";
  error?: string;
}

/**
 * Read content from stdin.
 * @returns The content read from stdin
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

/**
 * Read and parse a .env file or stdin.
 * @param filePath - File path or "-" for stdin
 * @returns Parsed key-value entries
 */
async function readEnvContent(filePath: string): Promise<Record<string, string>> {
  let content: string;
  if (filePath === "-") {
    content = await readStdin();
  } else {
    const absolutePath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    content = fs.readFileSync(absolutePath, "utf-8");
  }
  return parseEnv(content) as Record<string, string>;
}

export const importSecretCommand = defineCommand({
  name: "import",
  description: "Import secrets from a .env file into a vault.",
  args: z.object({
    ...commonArgs,
    ...workspaceArgs,
    ...vaultArgs,
    ...fileArgs,
    prefix: arg(z.string().optional(), {
      description: "Only import keys matching this prefix, stripping it from the secret name",
    }),
    "dry-run": arg(z.boolean().default(false), {
      alias: "d",
      description: "Preview changes without applying them",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const rawEntries = await readEnvContent(args.file);
    const prefix = args.prefix;

    // Apply prefix filter and strip prefix from key names
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawEntries)) {
      if (prefix) {
        if (!key.startsWith(prefix)) continue;
        entries[key.slice(prefix.length)] = value;
      } else {
        entries[key] = value;
      }
    }

    const entryNames = Object.keys(entries);

    if (entryNames.length === 0) {
      if (prefix) {
        logger.warn(`No entries matching prefix "${prefix}" found in the file.`);
      } else {
        logger.warn("No entries found in the file.");
      }
      return;
    }

    const source = args.file === "-" ? "stdin" : args.file;
    const prefixInfo = prefix ? ` (prefix: "${prefix}")` : "";
    logger.info(`Found ${entryNames.length} secret(s) in ${source}${prefixInfo}`);

    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    let existingSecretNames: Set<string>;
    try {
      const existingSecrets = await secretList({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        vaultName: args["vault-name"],
      });
      existingSecretNames = new Set(existingSecrets.map((s) => s.name));
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Vault "${args["vault-name"]}" not found.`);
      }
      throw error;
    }

    const toCreate = entryNames.filter((name) => !existingSecretNames.has(name));
    const toUpdate = entryNames.filter((name) => existingSecretNames.has(name));

    if (toCreate.length > 0) {
      logger.info(`Create: ${toCreate.length} secret(s)`);
      for (const name of toCreate) {
        logger.info(`  ${styles.create("+")} ${name}`, { mode: "plain" });
      }
    }
    if (toUpdate.length > 0) {
      logger.info(`Update: ${toUpdate.length} secret(s)`);
      for (const name of toUpdate) {
        logger.info(`  ${styles.update("~")} ${name}`, { mode: "plain" });
      }
    }

    if (args["dry-run"]) {
      logger.info("Dry run complete. No changes applied.");
      return;
    }

    const results: ImportResult[] = [];

    for (const name of toCreate) {
      try {
        await client.createSecretManagerSecret({
          workspaceId,
          secretmanagerVaultName: args["vault-name"],
          secretmanagerSecretName: name,
          secretmanagerSecretValue: entries[name],
        });
        results.push({ name, action: "created" });
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.AlreadyExists) {
          try {
            await client.updateSecretManagerSecret({
              workspaceId,
              secretmanagerVaultName: args["vault-name"],
              secretmanagerSecretName: name,
              secretmanagerSecretValue: entries[name],
            });
            results.push({ name, action: "updated" });
            continue;
          } catch (updateError) {
            const message =
              updateError instanceof Error ? updateError.message : String(updateError);
            results.push({ name, action: "failed", error: message });
            continue;
          }
        }
        const message = error instanceof Error ? error.message : String(error);
        results.push({ name, action: "failed", error: message });
      }
    }

    for (const name of toUpdate) {
      try {
        await client.updateSecretManagerSecret({
          workspaceId,
          secretmanagerVaultName: args["vault-name"],
          secretmanagerSecretName: name,
          secretmanagerSecretValue: entries[name],
        });
        results.push({ name, action: "updated" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ name, action: "failed", error: message });
      }
    }

    const created = results.filter((r) => r.action === "created");
    const updated = results.filter((r) => r.action === "updated");
    const failed = results.filter((r) => r.action === "failed");

    if (created.length > 0) {
      logger.success(`Created ${created.length} secret(s)`);
    }
    if (updated.length > 0) {
      logger.success(`Updated ${updated.length} secret(s)`);
    }
    if (failed.length > 0) {
      for (const f of failed) {
        logger.error(`Failed to import "${f.name}": ${f.error}`);
      }
      throw new Error(`${failed.length} secret(s) failed to import.`);
    }
  }),
});
