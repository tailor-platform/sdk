import { createPermissionNormalizer, hasOmittedPermit } from "#/parser/service/permission";
import type {
  StandardTailorTypePermission,
  StandardTailorTypeGqlPermission,
  StandardActionPermission,
  StandardPermissionCondition,
  StandardGqlPermissionPolicy,
  Permissions,
} from "#/parser/service/tailordb/types";
import type { GqlOperations, RawPermissions } from "#/types/tailordb.generated";

// Raw permission types for normalize function parameters
type PermissionOperator = "=" | "!=" | "in" | "not in" | "hasAny" | "not hasAny";

type PermissionCondition = readonly [unknown, PermissionOperator, unknown];

const { normalizeConditions, normalizeActionPermission: normalizeRawActionPermission } =
  createPermissionNormalizer<PermissionOperator, StandardPermissionCondition>({
    "=": "eq",
    "!=": "ne",
    in: "in",
    "not in": "nin",
    hasAny: "hasAny",
    "not hasAny": "nhasAny",
  });

type GqlPermissionPolicy = {
  conditions: readonly PermissionCondition[];
  actions: "all" | readonly GqlPermissionAction[];
  permit?: boolean;
  description?: string;
};

type GqlPermissionAction = "read" | "create" | "update" | "delete" | "aggregate" | "bulkUpsert";

/**
 * Normalize record-level permissions into a standard structure.
 * @param permission - Tailor table permission
 * @returns Normalized record permissions
 */
function normalizePermission(
  permission: NonNullable<RawPermissions["record"]>,
): StandardTailorTypePermission {
  const keys = Object.keys(permission) as Array<keyof typeof permission>;
  return keys.reduce((acc, action) => {
    acc[action] = permission[action].map((p) => normalizeActionPermission(p));
    return acc;
    // oxlint-disable-next-line no-explicit-any
  }, {} as any);
}

/**
 * Normalize GraphQL permissions into a standard structure.
 * @param permission - Tailor GQL permission
 * @returns Normalized GQL permissions
 */
export function normalizeGqlPermission(
  permission: NonNullable<RawPermissions["gql"]>,
): StandardTailorTypeGqlPermission {
  return (permission as readonly GqlPermissionPolicy[]).map((policy) => normalizeGqlPolicy(policy));
}

function normalizeGqlPolicy(policy: GqlPermissionPolicy): StandardGqlPermissionPolicy {
  return {
    conditions: normalizeConditions(policy.conditions),
    actions: policy.actions === "all" ? ["all"] : policy.actions,
    permit: policy.permit ? "allow" : "deny",
    description: policy.description,
  } as StandardGqlPermissionPolicy;
}

/**
 * Parse raw permissions into normalized permissions.
 * This is the main entry point for permission parsing in the parser layer.
 * @param rawPermissions - Raw permissions definition
 * @returns Normalized permissions
 */
export function parsePermissions(rawPermissions: RawPermissions): Permissions {
  return {
    ...(rawPermissions.record && {
      record: normalizePermission(rawPermissions.record),
    }),
    ...(rawPermissions.gql && {
      gql: normalizeGqlPermission(rawPermissions.gql),
    }),
  };
}

/**
 * Normalize a single action permission into the standard format.
 * @param permission - Raw permission definition
 * @returns Normalized action permission
 */
export function normalizeActionPermission(permission: unknown): StandardActionPermission {
  return normalizeRawActionPermission(permission);
}

/**
 * Find object-format permission rules that omit `permit` (which defaults to
 * `deny` there, unlike the array shorthand), so the CLI can warn about them.
 * @param rawPermissions - Raw permissions definition
 * @returns Dotted locations of offending rules, e.g. `record.read[0]`, `gql[1]`
 */
export function findOmittedPermitRules(rawPermissions: RawPermissions): string[] {
  const locations: string[] = [];

  const record = rawPermissions.record;
  if (record) {
    for (const action of Object.keys(record) as Array<keyof typeof record>) {
      record[action].forEach((rule: unknown, index: number) => {
        if (hasOmittedPermit(rule)) {
          locations.push(`record.${String(action)}[${index}]`);
        }
      });
    }
  }

  // GQL policies are always object form, so no isObjectFormat guard is needed.
  const gql = rawPermissions.gql;
  if (gql) {
    (gql as readonly GqlPermissionPolicy[]).forEach((policy, index) => {
      if (policy.permit === undefined) {
        locations.push(`gql[${index}]`);
      }
    });
  }

  return locations;
}

/**
 * Check whether GraphQL exposure is fully disabled for a table, given its
 * effective gqlOperations (the table's own setting, falling back to the
 * TailorDB namespace default). `undefined` means the default of all
 * operations enabled, so it is never considered fully disabled.
 * @param gqlOperations - Effective, normalized gqlOperations configuration
 * @returns Whether create, update, delete, and read are all explicitly disabled
 */
export function isGqlOperationsFullyDisabled(gqlOperations: GqlOperations | undefined): boolean {
  if (!gqlOperations) {
    return false;
  }
  return (
    gqlOperations.create === false &&
    gqlOperations.update === false &&
    gqlOperations.delete === false &&
    gqlOperations.read === false
  );
}

/**
 * Missing permission configuration detected for a TailorDB table.
 */
export interface MissingTypePermissionConfig {
  /** Whether record-level permission (`.permission()`) is missing */
  missingPermission: boolean;
  /** Whether GraphQL permission (`.gqlPermission()`) is missing while GraphQL exposure is enabled */
  missingGqlPermission: boolean;
}

/**
 * Find missing permission configuration for a TailorDB table.
 *
 * Record-level permission is always required: TailorDB denies all record
 * operations for a table without it, regardless of whether the table is
 * exposed via GraphQL. GraphQL permission is required whenever GraphQL
 * exposure is enabled for the table (the default, unless every operation is
 * explicitly disabled via `gqlOperations`).
 * @param rawPermissions - Raw permissions definition for the table
 * @param effectiveGqlOperations - The table's own gqlOperations, falling back to the namespace default
 * @returns Which permission configuration, if any, is missing
 */
export function findMissingPermissionConfig(
  rawPermissions: RawPermissions,
  effectiveGqlOperations: GqlOperations | undefined,
): MissingTypePermissionConfig {
  return {
    missingPermission: !rawPermissions.record,
    missingGqlPermission:
      !rawPermissions.gql && !isGqlOperationsFullyDisabled(effectiveGqlOperations),
  };
}
