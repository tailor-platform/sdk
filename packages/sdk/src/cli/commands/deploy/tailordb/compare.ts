import { toJsonString } from "@bufbuild/protobuf";
import { UpdateTailorDBTypeRequestSchema } from "@tailor-platform/tailor-proto/tailordb_pb";
import {
  TailorDBType_DisableGqlOperationsSchema,
  type TailorDBType_Permission,
  type TailorDBType_Permission_Policy,
  TailorDBType_Permission_PolicySchema,
  TailorDBType_PermissionSchema,
  TailorDBType_TypeHookSchema,
  TailorDBType_TypeSettingSchema,
  TailorDBType_TypeValidateSchema,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { defineRequestComparison, emptyMessageAsUnset } from "../compare";

type PermissionAction = Exclude<keyof TailorDBType_Permission, "$typeName" | "$unknown">;

function comparePolicies(
  left: TailorDBType_Permission_Policy,
  right: TailorDBType_Permission_Policy,
): number {
  const leftKey = toJsonString(TailorDBType_Permission_PolicySchema, left);
  const rightKey = toJsonString(TailorDBType_Permission_PolicySchema, right);
  if (leftKey === rightKey) return 0;
  return leftKey < rightKey ? -1 : 1;
}

/**
 * The table definition deploy compares with an existing table, both when planning a table
 * update and when `--no-schema-check` picks the local definitions that differ from the last
 * migration.
 */
export const tailordbTypeComparison = defineRequestComparison({
  schema: UpdateTailorDBTypeRequestSchema,
  excluded: ["workspaceId", "namespaceName", "updateMask"],
  normalize: ({ tailordbType }) => {
    const schema = tailordbType?.schema;
    if (!schema) return;
    // The SDK never sets these, while the platform returns legacy values for them.
    schema.typePermission = undefined;
    schema.recordPermission = undefined;
    schema.extends = false;
    schema.directives = [];
    // An empty message, such as the all-false operations the platform returns, sets nothing.
    if (schema.settings) {
      schema.settings.disableGqlOperations = emptyMessageAsUnset(
        TailorDBType_DisableGqlOperationsSchema,
        schema.settings.disableGqlOperations,
      );
    }
    schema.settings = emptyMessageAsUnset(TailorDBType_TypeSettingSchema, schema.settings);
    schema.typeHook = emptyMessageAsUnset(TailorDBType_TypeHookSchema, schema.typeHook);
    schema.typeValidate = emptyMessageAsUnset(TailorDBType_TypeValidateSchema, schema.typeValidate);
    schema.permission = emptyMessageAsUnset(TailorDBType_PermissionSchema, schema.permission);
    const { permission } = schema;
    for (const action of TailorDBType_PermissionSchema.fields) {
      const policies = permission?.[action.localName as PermissionAction] ?? [];
      for (const policy of policies) {
        // The platform returns an empty string for an unset description.
        policy.description ||= undefined;
      }
      // The platform evaluates the policies of an action regardless of their order.
      policies.sort(comparePolicies);
    }
  },
});
