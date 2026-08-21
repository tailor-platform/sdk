import * as inflection from "inflection";
import {
  type DiffChangeKind,
  MIN_SUPPORTED_MIGRATION_FILE_VERSION,
  SCHEMA_SNAPSHOT_VERSION,
} from "./diff-calculator";
import {
  type NormalizedSchemaSnapshot,
  type SchemaSnapshot,
  type SnapshotFieldConfig,
  type TailorDBSnapshotType,
} from "./snapshot-types";

/**
 * Platform default scale for decimal fields when scale is not explicitly specified.
 * Must stay in sync with the platform's default decimal scale.
 */
export const DEFAULT_DECIMAL_SCALE = 6;

export class UnsupportedMigrationFileVersionError extends Error {}

export function assertSupportedMigrationFileVersion(filePath: string, raw: unknown): void {
  if (typeof raw !== "object" || raw === null || !("version" in raw)) return;
  const version = raw.version;
  if (typeof version !== "number") return;
  if (
    Number.isInteger(version) &&
    version >= MIN_SUPPORTED_MIGRATION_FILE_VERSION &&
    version <= SCHEMA_SNAPSHOT_VERSION
  ) {
    return;
  }

  const supportedRange = `${MIN_SUPPORTED_MIGRATION_FILE_VERSION}-${SCHEMA_SNAPSHOT_VERSION}`;
  let guidance: string;
  if (version > SCHEMA_SNAPSHOT_VERSION) {
    guidance = `Upgrade to an SDK that supports migration file format version ${version}.`;
  } else if (version < MIN_SUPPORTED_MIGRATION_FILE_VERSION) {
    guidance =
      "Re-baseline with an SDK that still supports this migration history, then upgrade the SDK.";
  } else {
    guidance = "Restore the migration file from version control or regenerate it.";
  }
  throw new UnsupportedMigrationFileVersionError(
    `Unsupported migration file format version ${version} at ${filePath}. ` +
      `This SDK supports migration file format versions ${supportedRange}. ${guidance}`,
  );
}

/**
 * Diff change kinds renamed when TailorDB table terminology replaced "type".
 * Migration histories written before the rename persist the old names, so
 * diff.json files keep being read through this mapping.
 */
const LEGACY_CHANGE_KINDS = new Map<string, DiffChangeKind>([
  ["type_added", "table_added"],
  ["type_removed", "table_removed"],
  ["type_renamed", "table_renamed"],
  ["type_modified", "table_modified"],
  ["type_settings_modified", "table_settings_modified"],
  ["type_scripts_modified", "table_scripts_modified"],
]);

/**
 * Rewrite pre-rename `type_*` change kinds to their current `table_*` names
 * so that the diff schema, which only knows the current names, accepts them.
 * @param {unknown} raw - Parsed diff.json contents
 * @returns {unknown} Diff contents with legacy change kinds rewritten
 */
export function normalizeLegacyChangeKinds(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("changes" in raw)) return raw;
  const changes = raw.changes;
  if (!Array.isArray(changes)) return raw;

  const normalized = changes.map((change) => {
    if (typeof change !== "object" || change === null || !("kind" in change)) return change;
    const kind = (change as { kind: unknown }).kind;
    if (typeof kind !== "string") return change;
    const currentKind = LEGACY_CHANGE_KINDS.get(kind);
    return currentKind === undefined ? change : { ...change, kind: currentKind };
  });

  return { ...raw, changes: normalized };
}

/**
 * Persisted field names renamed when TailorDB table terminology replaced
 * "type". Applied to every entry that carries a table name, so diff.json files
 * written before the rename keep validating against the current schema.
 */
const LEGACY_ENTRY_FIELDS = new Map<string, string>([
  ["typeName", "tableName"],
  ["previousTypeName", "previousTableName"],
]);

function renameLegacyEntryFields(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
  const source = entry as Record<string, unknown>;
  const renamed: Record<string, unknown> = {};
  let changed = false;
  for (const [key, value] of Object.entries(source)) {
    const currentKey = LEGACY_ENTRY_FIELDS.get(key);
    if (currentKey !== undefined && !(currentKey in source)) {
      renamed[currentKey] = value;
      changed = true;
    } else {
      renamed[key] = value;
    }
  }
  return changed ? renamed : entry;
}

/** Persisted arrays whose entries carry a table name. */
const LEGACY_FIELD_CARRIERS = ["changes", "breakingChanges", "warnings"] as const;

/**
 * Move a pre-rename `types` record to `tables` so schema.json files written
 * before the rename keep validating against the current schema.
 * @param {unknown} raw - Parsed schema.json contents
 * @returns {unknown} Snapshot contents with the legacy key moved
 */
export function normalizeLegacyTablesKey(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const source = raw as Record<string, unknown>;
  if (!("types" in source) || "tables" in source) return raw;
  const { types, ...rest } = source;
  return { ...rest, tables: types };
}

/**
 * Rewrite the pre-rename `typeName` / `previousTypeName` keys to their current
 * names across every persisted position that carries a table name.
 * @param {unknown} raw - Parsed diff.json contents
 * @returns {unknown} Diff contents with legacy field names rewritten
 */
export function normalizeLegacyFieldNames(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const source = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...source };
  for (const key of LEGACY_FIELD_CARRIERS) {
    const entries = source[key];
    if (!Array.isArray(entries)) continue;
    normalized[key] = entries.map(renameLegacyEntryFields);
  }
  return normalized;
}

export function createSnapshotRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function copySnapshotRecord<T>(record: Record<string, T> | undefined): Record<string, T> {
  const copy = createSnapshotRecord<T>();
  for (const [key, value] of Object.entries(record ?? {})) {
    copy[key] = value;
  }
  return copy;
}

/**
 * Normalize a snapshot field into the canonical form for comparison, returning
 * a new object rather than mutating the input. Currently fills in the platform
 * default decimal scale when omitted, which avoids false drift between local
 * schemas (where scale may be omitted) and the platform (which always
 * materializes a scale).
 * @param {SnapshotFieldConfig} field - Field configuration to normalize
 * @returns {SnapshotFieldConfig} A new, normalized field object
 */
export function normalizeSnapshotField(field: SnapshotFieldConfig): SnapshotFieldConfig {
  const fields = field.fields
    ? Object.fromEntries(
        Object.entries(field.fields).map(([name, nested]) => [
          name,
          normalizeSnapshotField(nested),
        ]),
      )
    : undefined;

  return {
    ...field,
    ...(field.type === "decimal" && field.scale === undefined && { scale: DEFAULT_DECIMAL_SCALE }),
    ...(fields && { fields }),
  };
}

/**
 * Normalize a snapshot table into the canonical comparison shape, returning a
 * new object rather than mutating the input. Currently fills:
 *   - `pluralForm` via inflection when missing (legacy snapshots written
 *     before `pluralForm` became required may omit it)
 *   - per-field `scale` defaults via {@link normalizeSnapshotField}
 *
 * Idempotent — safe to call multiple times on the same input.
 * @param {TailorDBSnapshotType} type - Snapshot table to normalize
 * @returns {TailorDBSnapshotType} A new, normalized snapshot table object
 */
export function normalizeSnapshotType(type: TailorDBSnapshotType): TailorDBSnapshotType {
  // `pluralForm` is typed as required by TailorDBSnapshotType, but JSON.parse'd legacy
  // snapshots may have it undefined at runtime — backfill from inflection.
  const pluralForm =
    (type as { pluralForm?: string }).pluralForm || inflection.pluralize(type.name);
  const fields = createSnapshotRecord<SnapshotFieldConfig>();
  for (const [fieldName, field] of Object.entries(type.fields)) {
    fields[fieldName] = normalizeSnapshotField(field);
  }
  return { ...type, pluralForm, fields };
}

/**
 * Normalize a schema snapshot into the canonical comparison shape, returning a
 * new object rather than mutating the input.
 * @param {SchemaSnapshot} snapshot - Schema snapshot to normalize
 * @returns {NormalizedSchemaSnapshot} A new schema snapshot object branded as normalized
 */
export function normalizeSchemaSnapshot(snapshot: SchemaSnapshot): NormalizedSchemaSnapshot {
  const tables = createSnapshotRecord<TailorDBSnapshotType>();
  for (const [tableName, type] of Object.entries(snapshot.tables)) {
    tables[tableName] = normalizeSnapshotType(type);
  }
  return { ...snapshot, tables } as NormalizedSchemaSnapshot;
}

// Re-export SCHEMA_SNAPSHOT_VERSION for convenience
