import { createPermissionNormalizer, hasOmittedPermit } from "#/parser/service/permission";
import type { IdPPermission as RawIdPPermission } from "#/types/idp.generated";
import type {
  StandardIdPPermission,
  StandardIdPActionPermission,
  StandardIdPPermissionCondition,
} from "./types";

type PermissionOperator = "=" | "!=" | "in" | "not in";

const { normalizeActionPermission } = createPermissionNormalizer<
  PermissionOperator,
  StandardIdPPermissionCondition
>({
  "=": "eq",
  "!=": "ne",
  in: "in",
  "not in": "nin",
});

/**
 * Normalize a single IdP action permission into the standard format.
 * @param permission - Raw permission definition
 * @returns Normalized action permission
 */
export function normalizeIdPActionPermission(permission: unknown): StandardIdPActionPermission {
  return normalizeActionPermission(permission);
}

/**
 * Normalize raw IdP permission into standard form.
 * @param permission - Raw IdP permission from user config
 * @returns Normalized IdP permission
 */
export function normalizeIdPPermission(permission: RawIdPPermission): StandardIdPPermission {
  return {
    create: permission.create.map((p) => normalizeIdPActionPermission(p)),
    read: permission.read.map((p) => normalizeIdPActionPermission(p)),
    update: permission.update.map((p) => normalizeIdPActionPermission(p)),
    delete: permission.delete.map((p) => normalizeIdPActionPermission(p)),
    sendPasswordResetEmail: (permission.sendPasswordResetEmail ?? []).map((p) =>
      normalizeIdPActionPermission(p),
    ),
    unenrollMfa: (permission.unenrollMfa ?? []).map((p) => normalizeIdPActionPermission(p)),
  } as StandardIdPPermission;
}

/**
 * Parse raw IdP permission, returning undefined if not set.
 * @param rawPermission - Raw permission from parsed config
 * @returns Normalized permission or undefined
 */
export function parseIdPPermission(
  rawPermission: RawIdPPermission | undefined,
): StandardIdPPermission | undefined {
  if (!rawPermission) {
    return undefined;
  }
  return normalizeIdPPermission(rawPermission);
}

/**
 * Find object-format IdP permission rules that omit `permit` (which defaults
 * to `deny` there, unlike the array shorthand), so the CLI can warn about them.
 * @param permission - Raw IdP permission from user config
 * @returns Locations of offending rules, e.g. `read[0]`
 */
export function findOmittedPermitRules(permission: RawIdPPermission | undefined): string[] {
  if (!permission) {
    return [];
  }
  const locations: string[] = [];
  for (const action of Object.keys(permission) as Array<keyof typeof permission>) {
    permission[action]?.forEach((rule: unknown, index: number) => {
      if (hasOmittedPermit(rule)) {
        locations.push(`${String(action)}[${index}]`);
      }
    });
  }
  return locations;
}
