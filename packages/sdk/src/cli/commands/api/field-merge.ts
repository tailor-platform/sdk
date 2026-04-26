import { coerceEnumValue, coerceScalarValue } from "./coerce";
import { descendableMessageOf, getInputFieldByName } from "./proto-reflect";
import type { DescField, DescMessage } from "@bufbuild/protobuf";

export type MergeResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string };

export interface MergeFieldEntriesOptions {
  body: Record<string, unknown>;
  entries: ReadonlyArray<string>;
  methodInput: DescMessage;
}

interface ParsedEntry {
  rawKey: string;
  segments: string[];
  value: string;
}

function parseEntry(raw: string): ParsedEntry | { error: string } {
  const eqIndex = raw.indexOf("=");
  if (eqIndex < 0) {
    return { error: `--field entry must be in 'key=value' form: ${JSON.stringify(raw)}` };
  }
  const rawKey = raw.slice(0, eqIndex);
  const value = raw.slice(eqIndex + 1);
  if (rawKey === "") {
    return { error: `--field entry has empty key: ${JSON.stringify(raw)}` };
  }
  const segments = rawKey.split(".");
  if (segments.some((s) => s === "")) {
    return { error: `--field key has empty segment: ${JSON.stringify(rawKey)}` };
  }
  return { rawKey, segments, value };
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function suggestKeyFor(message: DescMessage, attempted: string): string {
  const camel = snakeToCamel(attempted);
  const direct = getInputFieldByName(message, camel);
  if (direct && camel !== attempted) {
    return ` (did you mean ${JSON.stringify(camel)}?)`;
  }
  const candidates = message.fields.map((f) => f.localName).join(", ");
  return candidates ? ` (available: ${candidates})` : "";
}

function coerceFieldValue(
  field: DescField,
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (field.fieldKind === "scalar") {
    return coerceScalarValue(field.scalar, raw);
  }
  if (field.fieldKind === "enum") {
    return coerceEnumValue(field.enum, raw);
  }
  if (field.fieldKind === "list") {
    if (field.listKind === "scalar") return coerceScalarValue(field.scalar, raw);
    if (field.listKind === "enum") return coerceEnumValue(field.enum, raw);
    return {
      ok: false,
      error: "list of messages cannot be set via --field; use --body for this field",
    };
  }
  return { ok: false, error: `unsupported field kind: ${field.fieldKind}` };
}

interface AssignContext {
  body: Record<string, unknown>;
  setLeafKeys: Set<string>; // joined dot path of leaf assignments
  oneofChosen: Map<string, string>; // `${parentDot}#${oneofName}` → chosen field localName
}

function assignField(
  ctx: AssignContext,
  parentMessage: DescMessage,
  segments: string[],
  rawKey: string,
  rawValue: string,
): { ok: true } | { ok: false; error: string } {
  // Walk segments; descend into nested messages as needed.
  const objStack: Record<string, unknown>[] = [ctx.body];
  let currentMessage = parentMessage;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined) {
      return { ok: false, error: `--field key ${JSON.stringify(rawKey)} has empty segment` };
    }
    const field = getInputFieldByName(currentMessage, segment);
    if (!field) {
      return {
        ok: false,
        error: `unknown field ${JSON.stringify(segment)} on ${currentMessage.typeName}${suggestKeyFor(currentMessage, segment)}`,
      };
    }

    const isLast = i === segments.length - 1;
    const localName = field.localName;
    const currentObj = objStack[objStack.length - 1];
    if (!currentObj) {
      return { ok: false, error: `internal: assignment stack empty for ${rawKey}` };
    }

    if (field.fieldKind === "map") {
      return {
        ok: false,
        error: `field ${JSON.stringify(rawKey)} is a map; map fields cannot be set via --field, use --body instead`,
      };
    }

    if (!isLast) {
      const nested = descendableMessageOf(field);
      if (!nested) {
        if (field.fieldKind === "list" && field.listKind === "message") {
          return {
            ok: false,
            error: `cannot nest into repeated message field ${JSON.stringify(localName)}; --field cannot build proto JSON arrays for repeated messages — use --body for ${rawKey}`,
          };
        }
        if (field.fieldKind === "message") {
          return {
            ok: false,
            error: `cannot nest into well-known type ${field.message.typeName} (${JSON.stringify(localName)}); proto JSON has a bespoke encoding for it — use --body for ${rawKey}`,
          };
        }
        return {
          ok: false,
          error: `cannot nest into ${field.fieldKind} field ${JSON.stringify(localName)}; --field key ${JSON.stringify(rawKey)} would require ${localName} to be a message`,
        };
      }
      const existing = currentObj[localName];
      if (existing === undefined) {
        const created: Record<string, unknown> = {};
        currentObj[localName] = created;
        objStack.push(created);
      } else if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        objStack.push(existing as Record<string, unknown>);
      } else {
        return {
          ok: false,
          error: `cannot merge --field ${JSON.stringify(rawKey)}: existing value at ${segments.slice(0, i + 1).join(".")} is not an object`,
        };
      }
      currentMessage = nested;
      continue;
    }

    // Last segment — assign value
    if (field.fieldKind === "message") {
      return {
        ok: false,
        error: `field ${JSON.stringify(rawKey)} is a message; use dot-notation (e.g. ${rawKey}.<sub>=...)`,
      };
    }

    const dotPath = segments.join(".");
    const coerced = coerceFieldValue(field, rawValue);
    if (!coerced.ok) {
      return { ok: false, error: `--field ${JSON.stringify(rawKey)}: ${coerced.error}` };
    }

    // Proto oneof exclusivity: clear sibling cases written by --body, and
    // reject conflicting --field entries that target the same oneof.
    if (field.oneof) {
      const parentDot = segments.slice(0, -1).join(".");
      const oneofKey = `${parentDot}#${field.oneof.name}`;
      const previous = ctx.oneofChosen.get(oneofKey);
      if (previous !== undefined && previous !== localName) {
        return {
          ok: false,
          error: `--field ${JSON.stringify(rawKey)}: oneof ${JSON.stringify(field.oneof.name)} already set via ${JSON.stringify(previous)}; only one case may be assigned`,
        };
      }
      for (const sibling of currentMessage.fields) {
        if (sibling.oneof?.name !== field.oneof.name) continue;
        if (sibling.localName === localName) continue;
        delete currentObj[sibling.localName];
      }
      ctx.oneofChosen.set(oneofKey, localName);
    }

    if (field.fieldKind === "list") {
      if (ctx.setLeafKeys.has(dotPath)) {
        const existing = currentObj[localName];
        if (Array.isArray(existing)) {
          existing.push(coerced.value);
        } else {
          currentObj[localName] = [coerced.value];
        }
      } else {
        currentObj[localName] = [coerced.value];
        ctx.setLeafKeys.add(dotPath);
      }
      return { ok: true };
    }

    if (ctx.setLeafKeys.has(dotPath)) {
      return {
        ok: false,
        error: `--field ${JSON.stringify(rawKey)}: not a repeated field, cannot be specified multiple times`,
      };
    }
    currentObj[localName] = coerced.value;
    ctx.setLeafKeys.add(dotPath);
    return { ok: true };
  }

  return { ok: false, error: `internal: empty path for ${rawKey}` };
}

export function mergeFieldEntries(opts: MergeFieldEntriesOptions): MergeResult {
  const body: Record<string, unknown> = { ...opts.body };
  const ctx: AssignContext = { body, setLeafKeys: new Set(), oneofChosen: new Map() };

  for (const raw of opts.entries) {
    const parsed = parseEntry(raw);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    const result = assignField(ctx, opts.methodInput, parsed.segments, parsed.rawKey, parsed.value);
    if (!result.ok) return result;
  }

  return { ok: true, body };
}
