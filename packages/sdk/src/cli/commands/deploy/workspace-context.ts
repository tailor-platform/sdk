import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "pathe";
import * as v from "valibot";
import { getDistDir } from "#/cli/shared/dist-dir";

// strip unknown keys
const workspaceContextSchema = v.object({
  version: v.literal(1),
  platformUrl: v.pipe(v.string(), v.url()),
  applicationId: v.optional(v.pipe(v.string(), v.minLength(1))),
  workspaceId: v.pipe(v.string(), v.uuid()),
});

export type WorkspaceContext = v.InferOutput<typeof workspaceContextSchema>;

function defaultConfigPath(): string {
  return resolve(process.cwd(), "tailor.config.ts");
}

function contextPath(configPath: string): string {
  return join(dirname(configPath), getDistDir(), `${basename(configPath)}.context.json`);
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

  const result = v.safeParse(workspaceContextSchema, value);
  if (
    !result.success ||
    result.output.platformUrl !== platformUrl ||
    (applicationId !== undefined && result.output.applicationId !== applicationId)
  ) {
    return undefined;
  }
  return result.output;
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
  const validated = v.parse(workspaceContextSchema, {
    ...context,
    ...(applicationId === undefined ? {} : { applicationId }),
  });
  const stateDirectory = join(dirname(configPath), getDistDir());
  const targetPath = contextPath(configPath);
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  try {
    if ((await readFile(targetPath, "utf8")) === serialized) return;
  } catch {
    // Missing or unreadable state should still fall through to the atomic replacement attempt.
  }
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(stateDirectory, { recursive: true });
  try {
    await writeFile(temporaryPath, serialized, { mode: 0o600 });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
