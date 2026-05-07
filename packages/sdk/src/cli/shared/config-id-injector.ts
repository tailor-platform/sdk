import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import { logger } from "./logger";
import type { CallExpression, ObjectExpression, ObjectProperty } from "@oxc-project/types";

export interface EnsureConfigIdResult {
  id: string;
  injected: boolean;
}

type ASTNode = Record<string, unknown>;

// Mirrors the platform metadata label value regex so that the generated id
// is always a valid label value when stamped onto resources.
const labelValueRegex = /^[a-z][a-z0-9_-]{0,62}$/;

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
        `'id' field in ${configPath} must be a string literal. Delete the field to regenerate.`,
      );
    }
    const literalValue = (value as { value?: unknown }).value;
    if (typeof literalValue !== "string" || literalValue === "") {
      throw new Error(
        `'id' field in ${configPath} must be a non-empty string literal. Delete the field to regenerate.`,
      );
    }
    if (!labelValueRegex.test(literalValue)) {
      throw new Error(
        `'id' field in ${configPath} must match ${labelValueRegex} (lowercase alnum, '-', '_'; start with a letter; max 63 chars). Delete the field to regenerate.`,
      );
    }
    return { id: literalValue, injected: false };
  }

  // Prefix with `app-` so the value satisfies the metadata label
  // regex `^[a-z][a-z0-9_-]{0,62}$` (UUIDs may start with a digit).
  const id = `app-${crypto.randomUUID()}`;
  const newSource = insertIdProperty(source, configObj, id);
  await fs.promises.writeFile(configPath, newSource, "utf-8");

  logger.info(`Generated app id and wrote to ${configPath}: ${id}`);

  return { id, injected: true };
}

function insertIdProperty(source: string, configObj: ObjectExpression, id: string): string {
  const idLiteral = `id: ${JSON.stringify(id)}`;
  if (configObj.properties.length > 0) {
    const firstProp = configObj.properties[0];
    const lineStart = source.lastIndexOf("\n", firstProp.start - 1) + 1;
    const indent = source.slice(lineStart, firstProp.start);
    const insertion = `${idLiteral},\n${indent}`;
    return source.slice(0, firstProp.start) + insertion + source.slice(firstProp.start);
  }
  // Empty object: insert just inside the braces
  const openBracePos = configObj.start + 1;
  const insertion = ` ${idLiteral} `;
  return source.slice(0, openBracePos) + insertion + source.slice(openBracePos);
}
