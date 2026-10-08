import { existsSync } from "node:fs";
import * as mod from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { EffectiveDateDefault } from "#/runtime/types";

/**
 * Read `defaultDateRepresentation` from an imported `tailor.config.ts` module.
 *
 * Accepts exactly what the config schema accepts: absent, `"temporal"`, or
 * `"date"`. Any other value is rejected rather than read as the legacy default, since the
 * CLI rejects the same config and the test run would otherwise disagree with it.
 * @param configModule - The imported module namespace
 * @returns The representation `t` date fields without `as` follow
 */
export function dateDefaultFromConfig(configModule: unknown): EffectiveDateDefault {
  const appConfig =
    configModule && typeof configModule === "object"
      ? (configModule as { default?: unknown }).default
      : undefined;
  const value =
    appConfig && typeof appConfig === "object"
      ? (appConfig as { defaultDateRepresentation?: unknown }).defaultDateRepresentation
      : undefined;
  if (value === undefined) return "legacy";
  if (value === "temporal" || value === "date") return value;
  throw new Error(
    `defaultDateRepresentation must be "temporal", "date", or omitted, but tailor.config.ts sets ${JSON.stringify(value)}.`,
  );
}

type TsHookModule = {
  resolveSync: Parameters<typeof mod.registerHooks>[0]["resolve"];
  loadSync: Parameters<typeof mod.registerHooks>[0]["load"];
};

// The hook is process-global, so loads are serialized to keep one load's
// deregistration from pulling the hook out from under another.
let pending: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = pending.then(task, task);
  pending = next.catch(() => undefined);
  return next;
}

// Imports the way the CLI does: the same TypeScript hook resolves extensionless
// relative imports and tsconfig paths, so a config the CLI accepts loads here.
async function importLikeCli(configPath: string): Promise<unknown> {
  const url = pathToFileURL(configPath).href;
  if ("Bun" in globalThis || "Deno" in globalThis) return import(url);
  const hookUrl = pathToFileURL(
    resolve(dirname(fileURLToPath(import.meta.url)), "../cli/ts-hook.mjs"),
  );
  const { resolveSync, loadSync } = (await import(hookUrl.href)) as TsHookModule;
  const hooks = mod.registerHooks({ resolve: resolveSync, load: loadSync }) as {
    deregister?: () => void;
  };
  try {
    return await import(url);
  } finally {
    hooks.deregister?.();
  }
}

// amaro reports a parse failure of the TypeScript source as a plain object
// with code "InvalidSyntax". A SyntaxError instance is not treated as one:
// config code that runs JSON.parse on a malformed environment variable throws
// the same class, and that is an evaluation failure, not a source problem.
function isSourceParseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "InvalidSyntax"
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Load `defaultDateRepresentation` from a `tailor.config.ts` file in the
 * Vitest host process, before the tailor-runtime environment applies.
 *
 * A missing file or a file that does not parse fails the run, as does a value
 * the config schema rejects. A config that throws while being evaluated, for
 * example on an environment variable only the deploy environment sets, is
 * reported and read as the legacy default, the way the secrets loader has
 * always tolerated it.
 * @param configPath - Absolute path to tailor.config.ts
 * @returns The representation `t` date fields without `as` follow
 */
export async function loadDateDefaultFromConfig(configPath: string): Promise<EffectiveDateDefault> {
  if (!existsSync(configPath)) {
    throw new Error(
      `tailor-runtime: tailor.config.ts not found at ${configPath}. Check the \`config\` option of tailorRuntime().`,
    );
  }
  let configModule: unknown;
  try {
    configModule = await serialize(() => importLikeCli(configPath));
  } catch (error) {
    if (isSourceParseError(error)) {
      throw new Error(`tailor-runtime could not parse ${configPath}: ${describeError(error)}`, {
        cause: error,
      });
    }
    console.warn(
      `tailor-runtime could not load ${configPath} to read defaultDateRepresentation; t date fields use string values in this run. If the config sets "temporal", tests disagree with tailor.d.ts until the error is fixed: ${describeError(error)}`,
    );
    return "legacy";
  }
  return dateDefaultFromConfig(configModule);
}
