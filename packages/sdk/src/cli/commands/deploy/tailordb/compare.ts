import { type MessageInitShape } from "@bufbuild/protobuf";
import { TailorDBTypeSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { areNormalizedEqual, normalizeProtoConfig, toComparableProtoJson } from "../compare";
import type { TailorDBDeployInput } from "#/cli/commands/tailordb/migrate/schema-checks";

function normalizeComparableTailorDBService(service: {
  namespace?: string;
  defaultTimezone?: string;
}) {
  return normalizeProtoConfig({
    namespace: service.namespace,
    defaultTimezone: service.defaultTimezone || "UTC",
  });
}

export function areTailorDBServicesEqual(
  existing: {
    namespace?: { name?: string };
    defaultTimezone?: string;
  },
  desired: Readonly<TailorDBDeployInput>,
): boolean {
  return areNormalizedEqual(
    normalizeComparableTailorDBService({
      namespace: existing.namespace?.name,
      defaultTimezone: existing.defaultTimezone,
    }),
    normalizeComparableTailorDBService({
      namespace: desired.namespace,
      defaultTimezone: "UTC",
    }),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const tailordbCompareKnownDefaults = {
  /**
   * Platform returns this object with explicit false flags even when the SDK omitted
   * gqlOperations entirely. Treat the all-false object as "unset" for diff purposes.
   */
  disableGqlOperations: {
    create: false,
    update: false,
    delete: false,
    read: false,
  },
  /**
   * Some remote validate expressions are emitted as an empty string when the SDK did
   * not define a script. Local manifests omit the field entirely.
   */
  emptyExpression: "",
  /**
   * Proto bigint-backed values can round-trip as numbers locally and strings remotely.
   * Canonicalize them to strings at compare time.
   */
  numericStringPaths: new Set([
    "schema.fields.*.serial.start",
    "schema.fields.*.serial.maxValue",
    "schema.settings.defaultQueryLimitSize",
    "schema.settings.maxBulkUpsertSize",
  ]),
} as const;

export function normalizeComparableTailorDBType(type: MessageInitShape<typeof TailorDBTypeSchema>) {
  const canonical = toComparableProtoJson(TailorDBTypeSchema, type);
  const normalized = normalizeProtoConfig(canonical) as {
    name?: string;
    schema?: {
      description?: string;
      fields?: Record<string, unknown>;
      relationships?: Record<string, unknown>;
      settings?: Record<string, unknown>;
      indexes?: Record<string, unknown>;
      files?: Record<string, unknown>;
      permission?: Record<string, unknown>;
      typeHook?: Record<string, unknown>;
      typeValidate?: Record<string, unknown>;
    };
  } | null;
  return normalizeTailorDBCompareValue(
    {
      name: normalized?.name ?? "",
      schema: {
        description: normalized?.schema?.description ?? "",
        fields: normalized?.schema?.fields ?? {},
        relationships: normalized?.schema?.relationships ?? {},
        settings: normalized?.schema?.settings ?? {},
        indexes: normalized?.schema?.indexes ?? {},
        files: normalized?.schema?.files ?? {},
        permission: normalized?.schema?.permission ?? {},
        // Hooks/validators are sent as table-level scripts; include them so a
        // changed hook or validator is detected as an update.
        typeHook: normalized?.schema?.typeHook ?? {},
        typeValidate: normalized?.schema?.typeValidate ?? {},
      },
    },
    [],
  );
}

function isPermissionPolicyArrayPath(path: readonly (string | number)[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "schema" &&
    path[1] === "permission" &&
    (path[2] === "create" || path[2] === "read" || path[2] === "update" || path[2] === "delete")
  );
}

function normalizeTailorDBCompareValue(
  value: unknown,
  path: readonly (string | number)[],
): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === "boolean") {
    if (path.at(-1) === "optionalOnCreate" && value === false) {
      return undefined;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    if (matchesNumericStringPath(path) && isNumericLikeValue(value)) {
      return String(value);
    }
    if (
      (path.at(-1) === "expr" || path.at(-1) === "description") &&
      value === tailordbCompareKnownDefaults.emptyExpression
    ) {
      return undefined;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item, index) => normalizeTailorDBCompareValue(item, [...path, index]))
      .filter((item) => item !== undefined);
    // Field-level validators are no longer emitted by the SDK (they are aggregated
    // into table-level type_validate). The platform still returns an empty `validate`
    // array per field; treat it as unset so it matches the omitted local value.
    if (items.length === 0 && path.at(-1) === "validate") {
      return undefined;
    }
    // The platform evaluates permission policies order-insensitively (any
    // matching deny wins over any matching allow), while committed migration
    // snapshots can record the same policies in a different order than the
    // current config parse — so compare each action's policies as a set.
    if (isPermissionPolicyArrayPath(path)) {
      return items.toSorted((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    }
    return items;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalizedEntries = Object.entries(value)
    .map(
      ([key, entryValue]) =>
        [key, normalizeTailorDBCompareValue(entryValue, [...path, key])] as const,
    )
    .filter(([, entryValue]) => entryValue !== undefined);

  const normalizedObject = Object.fromEntries(normalizedEntries);

  if (path.at(-1) === "fields" && Object.keys(normalizedObject).length === 0) {
    return undefined;
  }

  if (
    path.at(-1) === "disableGqlOperations" &&
    (Object.keys(normalizedObject).length === 0 ||
      areNormalizedEqual(normalizedObject, tailordbCompareKnownDefaults.disableGqlOperations))
  ) {
    return undefined;
  }

  return normalizedObject;
}

function matchesNumericStringPath(path: readonly (string | number)[]): boolean {
  const pathKey = path.map((segment) => String(segment)).join(".");
  return [...tailordbCompareKnownDefaults.numericStringPaths].some((pattern) => {
    const patternParts = pattern.split(".");
    const pathParts = pathKey.split(".");
    if (patternParts.length !== pathParts.length) {
      return false;
    }
    return patternParts.every((part, index) => part === "*" || part === pathParts[index]);
  });
}

function isNumericLikeValue(value: string | number | bigint): boolean {
  return typeof value === "number" || typeof value === "bigint" || /^-?\d+$/.test(value);
}

export function normalizeComparableGqlPermission(permission: unknown) {
  const normalized = normalizeProtoConfig(permission) as {
    policies?: Array<{
      actions?: number[];
      conditions?: unknown[];
      permit?: number;
      description?: string;
    }>;
  } | null;
  return {
    policies: (normalized?.policies ?? []).map((policy) => ({
      ...policy,
      actions: (policy.actions ?? []).toSorted((left, right) => left - right),
    })),
  };
}
