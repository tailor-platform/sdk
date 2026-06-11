import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import { isCI } from "std-env";
import { logger } from "@/cli/shared/logger";
import { parseBoolean } from "@/cli/shared/parse-boolean";
import type { CallExpression, ObjectExpression, ObjectProperty } from "@oxc-project/types";

export interface EnsureConfigIdResult {
  id: string;
  injected: boolean;
}

type ASTNode = Record<string, unknown>;

// The user-facing id is a plain UUID. A label-compatible prefix is added
// at the metadata boundary in `cli/commands/deploy/label.ts`, so the
// in-config value does not need to satisfy the platform label-value regex.
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ConfigCallSite {
  callExpr: CallExpression;
  configObj: ObjectExpression | null;
}

function findDefineConfigCalls(node: unknown, results: ConfigCallSite[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as ASTNode;

  if (n.type === "CallExpression") {
    const ce = n as unknown as CallExpression;
    if (ce.callee.type === "Identifier" && ce.callee.name === "defineConfig") {
      const arg = ce.arguments[0];
      const configObj = arg && arg.type === "ObjectExpression" ? (arg as ObjectExpression) : null;
      results.push({ callExpr: ce, configObj });
    }
  }

  for (const key of Object.keys(n)) {
    const child = n[key];
    if (Array.isArray(child)) {
      for (const c of child) findDefineConfigCalls(c, results);
    } else if (child && typeof child === "object") {
      findDefineConfigCalls(child, results);
    }
  }
}

function findIdProperty(obj: ObjectExpression): ObjectProperty | null {
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const keyName =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal"
          ? (prop.key as { value?: unknown }).value
          : null;
    if (keyName === "id") return prop;
  }
  return null;
}

/**
 * Ensure `tailor.config.ts` has an `id` property on the `defineConfig({...})`
 * argument. Generates a UUID when missing and writes it back to the file.
 * Returns null when the file does not contain a `defineConfig()` call (e.g.
 * a wrapper that re-exports another config).
 * @param configPath - Absolute path to the config file
 * @returns Resolved id and whether it was newly injected, or null if skipped
 */
export async function ensureConfigId(configPath: string): Promise<EnsureConfigIdResult | null> {
  const source = await fs.promises.readFile(configPath, "utf-8");
  const { program } = parseSync(configPath, source);

  const calls: ConfigCallSite[] = [];
  findDefineConfigCalls(program, calls);

  if (calls.length === 0) {
    // Wrapper/re-export file: defineConfig is in another file. Nothing to do here.
    return null;
  }
  if (calls.length > 1) {
    throw new Error(`Multiple defineConfig() calls found in ${configPath}. Only one is supported.`);
  }

  const { configObj } = calls[0];
  if (!configObj) {
    throw new Error(
      `defineConfig() argument must be an inline object literal in ${configPath} so the SDK can manage the 'id' field.`,
    );
  }

  const idProp = findIdProperty(configObj);
  if (idProp) {
    const value = idProp.value;
    if (value.type !== "Literal") {
      throw new Error(
        `'id' field in ${configPath} must be a string literal. To use this config for a separate app, delete it.`,
      );
    }
    const literalValue = (value as { value?: unknown }).value;
    if (typeof literalValue !== "string" || literalValue === "") {
      throw new Error(
        `'id' field in ${configPath} must be a non-empty string literal. To use this config for a separate app, delete it.`,
      );
    }
    if (!uuidRegex.test(literalValue)) {
      throw new Error(
        `'id' field in ${configPath} must be a UUID. To use this config for a separate app, delete it.`,
      );
    }
    return { id: literalValue, injected: false };
  }

  const id = crypto.randomUUID();
  const newSource = insertIdProperty(source, configObj, id);
  await fs.promises.writeFile(configPath, newSource, "utf-8");

  logger.info(`Generated app id and wrote to ${configPath}: ${id}`);

  return { id, injected: true };
}

/**
 * Read the resolved `defineConfig({...})` `id` from a config file without
 * mutating it. Returns null when the file has no `defineConfig()` call (wrapper
 * config) or no `id` property.
 * @param configPath - Absolute path to the config file
 * @returns The existing id, or null
 */
async function readConfigId(configPath: string): Promise<string | null> {
  const source = await fs.promises.readFile(configPath, "utf-8");
  const { program } = parseSync(configPath, source);
  const calls: ConfigCallSite[] = [];
  findDefineConfigCalls(program, calls);
  if (calls.length !== 1 || !calls[0].configObj) return null;
  const idProp = findIdProperty(calls[0].configObj);
  if (!idProp || idProp.value.type !== "Literal") return null;
  const value = (idProp.value as { value?: unknown }).value;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Ensure the config has an app id for a deploy run.
 *
 * Locally, the id is auto-injected when missing (via {@link ensureConfigId}).
 * In CI, the id is never auto-injected — a missing id is a hard error, because
 * generating one per run would create a fresh app each time and break resource
 * ownership. Ephemeral pipelines that intentionally deploy a fresh app per run
 * (such as e2e harnesses) can opt back into injection with
 * `TAILOR_PLATFORM_SDK_ALLOW_CI_ID_INJECTION=true`. Dry-run and build-only
 * flows skip both injection and the check (no on-disk side effects are
 * expected).
 * @param obj - Inputs
 * @param obj.configPath - Absolute path to the config file
 * @param obj.dryRun - Whether this is a dry-run
 * @param obj.buildOnly - Whether this is a build-only run
 */
export async function ensureConfigIdForDeploy(obj: {
  configPath: string;
  dryRun: boolean;
  buildOnly: boolean;
}): Promise<void> {
  const { configPath, dryRun, buildOnly } = obj;
  if (dryRun || buildOnly) return;

  const allowCIInjection =
    parseBoolean(process.env.TAILOR_PLATFORM_SDK_ALLOW_CI_ID_INJECTION) === true;
  if (isCI && !allowCIInjection) {
    const id = await readConfigId(configPath);
    if (!id) {
      throw new Error(
        `tailor.config.ts is missing an 'id'. CI does not auto-generate one ` +
          `(each run would be treated as a separate app and break resource ownership). ` +
          `Run 'tailor-sdk setup github' or 'tailor-sdk apply' locally and commit the injected id.`,
      );
    }
    // Keep CI and local behavior aligned: ensureConfigId() enforces the same
    // format when injecting locally.
    if (!uuidRegex.test(id)) {
      throw new Error(
        `'id' in ${configPath} must be a UUID. To use this config for a separate app, delete it.`,
      );
    }
    return;
  }

  await ensureConfigId(configPath);
}

const idComment =
  "// SDK-managed app id — do not edit, except when copying this config to a separate app.";

function insertIdProperty(source: string, configObj: ObjectExpression, id: string): string {
  const idLiteral = `id: ${JSON.stringify(id)}`;
  if (configObj.properties.length > 0) {
    const firstProp = configObj.properties[0];
    const lineStart = source.lastIndexOf("\n", firstProp.start - 1) + 1;
    const indent = source.slice(lineStart, firstProp.start);
    const insertion = `${idComment}\n${indent}${idLiteral},\n${indent}`;
    return source.slice(0, firstProp.start) + insertion + source.slice(firstProp.start);
  }
  // Empty object: insert on its own lines so the `//` comment does not
  // bleed into the closing `}` / `)`. Derive indent from the line that
  // contains the opening brace.
  const openBracePos = configObj.start + 1;
  const braceLineStart = source.lastIndexOf("\n", configObj.start) + 1;
  const baseIndent = source.slice(braceLineStart).match(/^[\t ]*/)?.[0] ?? "";
  const innerIndent = `${baseIndent}  `;
  const insertion = `\n${innerIndent}${idComment}\n${innerIndent}${idLiteral},\n${baseIndent}`;
  return source.slice(0, openBracePos) + insertion + source.slice(openBracePos);
}
