import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "pathe";
import { z } from "zod";

const workspaceContextSchema = z.object({
  version: z.literal(1),
  platformUrl: z.url(),
  workspaceId: z.uuid(),
  workspaceName: z.string().optional(),
  workspaceRegion: z.string().optional(),
  organizationId: z.uuid().optional(),
  folderId: z.uuid().optional(),
});

export type WorkspaceContext = z.output<typeof workspaceContextSchema>;

function defaultConfigPath(): string {
  return resolve(process.cwd(), "tailor.config.ts");
}

function contextPath(configPath: string): string {
  return join(dirname(configPath), ".tailor-sdk", `${basename(configPath)}.context.json`);
}

/**
 * Load the project workspace context when it belongs to the current platform.
 * Missing, malformed, and cross-platform state is ignored.
 * @param platformUrl - Current Platform API base URL
 * @param configPath - Configuration file whose workspace selection is loaded
 * @returns Valid context for the current platform, or undefined
 */
export async function loadWorkspaceContext(
  platformUrl: string,
  configPath = defaultConfigPath(),
): Promise<WorkspaceContext | undefined> {
  let contents: string;
  try {
    contents = await readFile(contextPath(configPath), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    return undefined;
  }

  const result = workspaceContextSchema.safeParse(value);
  if (!result.success || result.data.platformUrl !== platformUrl) return undefined;
  return result.data;
}

/**
 * Persist the selected workspace as project-local SDK state.
 * @param context - Workspace context to persist
 * @param configPath - Configuration file whose workspace selection is persisted
 */
export async function saveWorkspaceContext(
  context: WorkspaceContext,
  configPath = defaultConfigPath(),
): Promise<void> {
  const validated = workspaceContextSchema.parse(context);
  const stateDirectory = join(dirname(configPath), ".tailor-sdk");
  const targetPath = contextPath(configPath);
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, targetPath);
}
