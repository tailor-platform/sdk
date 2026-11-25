import { toJsonString } from "@bufbuild/protobuf";
import { UpdateTailorDBTypeRequestSchema } from "@tailor-platform/tailor-proto/tailordb_pb";
import {
  TailorDBType_DisableGqlOperationsSchema,
  type TailorDBType_Permission_Policy,
  TailorDBType_Permission_PolicySchema,
  TailorDBType_PermissionSchema,
  TailorDBType_TypeHookSchema,
  TailorDBType_TypeSettingSchema,
  TailorDBType_TypeValidateSchema,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { actionPolicyLists, defineRequestComparison, unsetEmptyMessage } from "../compare";

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
    delete schema.typePermission;
    delete schema.recordPermission;
    schema.extends = false;
    schema.directives = [];
    // An empty message, such as the all-false operations the platform returns, sets nothing.
    if (schema.settings) {
      unsetEmptyMessage({
        schema: TailorDBType_DisableGqlOperationsSchema,
        owner: schema.settings,
        key: "disableGqlOperations",
      });
    }
    unsetEmptyMessage({ schema: TailorDBType_TypeSettingSchema, owner: schema, key: "settings" });
    unsetEmptyMessage({ schema: TailorDBType_TypeHookSchema, owner: schema, key: "typeHook" });
    unsetEmptyMessage({
      schema: TailorDBType_TypeValidateSchema,
      owner: schema,
      key: "typeValidate",
    });
    unsetEmptyMessage({ schema: TailorDBType_PermissionSchema, owner: schema, key: "permission" });
    for (const policies of actionPolicyLists(TailorDBType_PermissionSchema, schema.permission)) {
      for (const policy of policies) {
        // The platform returns an empty string for an unset description.
        if (!policy.description) delete policy.description;
      }
      // The platform evaluates the policies of an action regardless of their order.
      policies.sort(comparePolicies);
    }
  },
});
