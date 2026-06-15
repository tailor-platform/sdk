import type {
  StandardIdPPermission,
  StandardIdPActionPermission,
  StandardIdPPermissionCondition,
  IdPPermissionOperand,
  IdPUserField,
} from "./types";
import type { IdPPermission as RawIdPPermission } from "@/types/idp.generated";

type PermissionOperator = "=" | "!=" | "in" | "not in";

type ObjectOperand =
  | { user: string }
  | { idpUser: IdPUserField }
  | { oldIdpUser: IdPUserField }
  | { newIdpUser: IdPUserField };

type ValueOperand = string | boolean | string[] | boolean[];

type RawPermissionOperand = ObjectOperand | ValueOperand;

type PermissionCondition = readonly [
  RawPermissionOperand,
  PermissionOperator,
  RawPermissionOperand,
];

const operatorMap: Record<PermissionOperator, string> = {
  "=": "eq",
  "!=": "ne",
  in: "in",
  "not in": "nin",
};

function normalizeOperand(operand: RawPermissionOperand): IdPPermissionOperand {
  if (typeof operand === "object" && !Array.isArray(operand) && "user" in operand) {
    const mapped = operand.user === "id" ? "_id" : operand.user;
    return { user: mapped };
  }
  return operand as IdPPermissionOperand;
}

function normalizeConditions(
  conditions: readonly PermissionCondition[],
): StandardIdPPermissionCondition[] {
  return conditions.map((cond) => {
    const [left, operator, right] = cond;
    return [normalizeOperand(left), operatorMap[operator], normalizeOperand(right)];
  }) as StandardIdPPermissionCondition[];
}

function isObjectFormat(
  p: unknown,
): p is { conditions: unknown; permit?: boolean; description?: string } {
  return typeof p === "object" && p !== null && "conditions" in p;
}

function isSingleArrayConditionFormat(cond: readonly unknown[]): boolean {
  return cond.length >= 2 && typeof cond[1] === "string";
}

/**
 * Normalize a single IdP action permission into the standard format.
 * @param permission - Raw permission definition
 * @returns Normalized action permission
 */
export function normalizeIdPActionPermission(permission: unknown): StandardIdPActionPermission {
  if (isObjectFormat(permission)) {
    const conditions = permission.conditions as
      | PermissionCondition
      | readonly PermissionCondition[];
    return {
      conditions: normalizeConditions(
        isSingleArrayConditionFormat(conditions)
          ? [conditions as PermissionCondition]
          : (conditions as readonly PermissionCondition[]),
      ),
      permit: permission.permit ? "allow" : "deny",
      description: permission.description,
    };
  }

  if (!Array.isArray(permission)) {
    throw new Error("Invalid permission format");
  }

  if (isSingleArrayConditionFormat(permission)) {
    const [op1, operator, op2, permit] = [...permission, true] as [
      RawPermissionOperand,
      string,
      RawPermissionOperand,
      boolean,
    ];
    return {
      conditions: normalizeConditions([[op1, operator, op2] as PermissionCondition]),
      permit: permit ? "allow" : "deny",
    };
  }

  const conditions: PermissionCondition[] = [];
  const conditionArray = permission as readonly unknown[];
  let conditionArrayPermit = true;

  for (const item of conditionArray) {
    if (typeof item === "boolean") {
      conditionArrayPermit = item;
      continue;
    }
    conditions.push(item as PermissionCondition);
  }

  return {
    conditions: normalizeConditions(conditions),
    permit: conditionArrayPermit ? "allow" : "deny",
  };
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
    sendPasswordResetEmail: permission.sendPasswordResetEmail.map((p) =>
      normalizeIdPActionPermission(p),
    ),
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
 * Find object-format IdP permission rules that omit `permit`.
 *
 * Object-format rules default to `deny` when `permit` is omitted, whereas the
 * array shorthand defaults to `allow`. Omitting `permit` on an object rule is
 * therefore an easy way to accidentally deny access you meant to grant, so the
 * CLI warns about these locations to nudge authors toward setting `permit`
 * explicitly.
 * @param permission - Raw IdP permission from user config
 * @returns Locations of offending rules, e.g. `read[0]`
 */
export function findOmittedPermitRules(permission: RawIdPPermission | undefined): string[] {
  if (!permission) {
    return [];
  }
  const locations: string[] = [];
  for (const action of Object.keys(permission) as Array<keyof typeof permission>) {
    // raw user input may omit action keys the type marks required
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    permission[action]?.forEach((rule: unknown, index: number) => {
      if (isObjectFormat(rule) && rule.permit === undefined) {
        locations.push(`${String(action)}[${index}]`);
      }
    });
  }
  return locations;
}
