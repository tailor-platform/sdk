import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "pathe";
import { z } from "zod";

const workspaceContextSchema = z.object({
  version: z.literal(1),
  platformUrl: z.url(),
  applicationId: z.string().min(1).optional(),
  workspaceId: z.uuid(),
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
 * @param applicationId - Application identity that must match the saved context
 * @returns Valid context for the current platform, or undefined
 */
export async function loadWorkspaceContext(
  platformUrl: string,
  configPath = defaultConfigPath(),
  applicationId?: string,
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
  if (
    !result.success ||
    result.data.platformUrl !== platformUrl ||
    (applicationId !== undefined && result.data.applicationId !== applicationId)
  ) {
    return undefined;
  }
  return result.data;
}

/**
 * Persist the selected workspace as project-local SDK state.
 * @param context - Workspace context to persist
 * @param configPath - Configuration file whose workspace selection is persisted
 * @param applicationId - Application identity stored with the workspace selection
 */
export async function saveWorkspaceContext(
  context: WorkspaceContext,
  configPath = defaultConfigPath(),
  applicationId?: string,
): Promise<void> {
  const validated = workspaceContextSchema.parse({
    ...context,
    ...(applicationId === undefined ? {} : { applicationId }),
  });
  const stateDirectory = join(dirname(configPath), ".tailor-sdk");
  const targetPath = contextPath(configPath);
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  await mkdir(stateDirectory, { recursive: true });
  try {
    if ((await readFile(targetPath, "utf8")) === serialized) return;
  } catch {
    // Missing or unreadable state should still fall through to the atomic replacement attempt.
  }
  try {
    await writeFile(temporaryPath, serialized, { mode: 0o600 });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
