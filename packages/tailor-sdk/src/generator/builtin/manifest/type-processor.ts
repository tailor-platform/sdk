import { TailorDBType } from "@/services/tailordb/schema";
import {
  ManifestTypeMetadata,
  ManifestFieldMetadata,
  GQLPermissionManifest,
  GQLPermissionPolicyManifest,
  GQLPermissionConditionManifest,
} from "./types";
import { tailorToManifestScalar } from "@/types/types";
import { capitalize } from "inflection";
import {
  gqlOperandKeys,
  PermissionOperand,
  recordOperandKeys,
  StandardGqlPermissionPolicy,
  StandardTailorTypePermission,
} from "@/services/tailordb/permission";

export class TypeProcessor {
  /**
   * ネストしたフィールドを再帰的に処理
   */
  private static processNestedFields(objectFields: any): any {
    const nestedFields: any = {};

    Object.entries(objectFields).forEach(
      ([nestedFieldName, nestedFieldDef]: [string, any]) => {
        const nestedMetadata = nestedFieldDef.metadata;

        if (nestedMetadata.type === "nested" && nestedFieldDef.fields) {
          const deepNestedFields = TypeProcessor.processNestedFields(
            nestedFieldDef.fields,
          );
          nestedFields[nestedFieldName] = {
            Type: "nested",
            AllowedValues: nestedMetadata.allowedValues || [],
            Description: nestedMetadata.description || "",
            Validate: [],
            Required: nestedMetadata.required ?? true,
            Array: nestedMetadata.array ?? false,
            Index: false,
            Unique: false,
            ForeignKey: false,
            Vector: false,
            Fields: deepNestedFields,
          };
        } else {
          nestedFields[nestedFieldName] = {
            Type:
              tailorToManifestScalar[
                nestedMetadata.type as keyof typeof tailorToManifestScalar
              ] || nestedMetadata.type,
            AllowedValues: nestedMetadata.allowedValues || [],
            Description: nestedMetadata.description || "",
            Validate: [],
            Required: nestedMetadata.required ?? true,
            Array: nestedMetadata.array ?? false,
            Index: false,
            Unique: false,
            ForeignKey: false,
            Vector: false,
            ...(nestedMetadata.serial && {
              Serial: {
                Start: nestedMetadata.serial.start,
                ...(nestedMetadata.serial.maxValue && {
                  MaxValue: nestedMetadata.serial.maxValue,
                }),
                ...(nestedMetadata.serial.format && {
                  Format: nestedMetadata.serial.format,
                }),
              },
            }),
          };
        }
      },
    );

    return nestedFields;
  }

  /**
   * 単一のTailorDBTypeに対するマニフェスト生成処理
   * 元のManifestAggregator.generateTailorDBManifest相当の処理を単一型に適用
   */
  static generateTailorDBTypeManifest(type: TailorDBType): any {
    const metadata = type.metadata;
    const schema = metadata.schema;

    const defaultTypePermission = {
      Create: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
      Read: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
      Update: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
      Delete: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
      Admin: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
    };

    const defaultSettings = {
      Aggregation: schema?.settings?.aggregation || false,
      BulkUpsert: schema?.settings?.bulkUpsert || false,
      Draft: false,
      DefaultQueryLimitSize: 100,
      MaxBulkUpsertSize: 1000,
      PluralForm: schema?.settings?.pluralForm
        ? schema.settings.pluralForm.charAt(0).toLowerCase() +
          schema.settings.pluralForm.slice(1)
        : "",
      PublishRecordEvents: false,
    };

    const fields: any = {};
    if (schema?.fields) {
      Object.entries(schema.fields)
        .filter(([fieldName]) => fieldName !== "id")
        .forEach(([fieldName, fieldConfig]) => {
          const fieldType = fieldConfig.type || "string";
          const fieldEntry: any = {
            Type: fieldType,
            AllowedValues:
              fieldType === "enum" ? fieldConfig.allowedValues || [] : [],
            Description: fieldConfig.description || "",
            Validate: (fieldConfig.validate || []).map((val: any) => ({
              Action: "deny",
              ErrorMessage: val.errorMessage || "",
              Expr: val.expr || "",
              ...(val.script && {
                Script: {
                  Expr: val.script.expr ? `!${val.script.expr}` : "",
                },
              }),
            })),
            Array: fieldConfig.array || false,
            Index: (fieldConfig.index && !fieldConfig.array) || false,
            Unique: (fieldConfig.unique && !fieldConfig.array) || false,
            ForeignKey: fieldConfig.foreignKey || false,
            ForeignKeyType: fieldConfig.foreignKeyType,
            Required: fieldConfig.required !== false,
            Vector: fieldConfig.vector || false,
            ...(fieldConfig.hooks && {
              Hooks: {
                Create: fieldConfig.hooks?.create
                  ? {
                      Expr: fieldConfig.hooks.create.expr || "",
                    }
                  : undefined,
                Update: fieldConfig.hooks?.update
                  ? {
                      Expr: fieldConfig.hooks.update.expr || "",
                    }
                  : undefined,
              },
            }),
            ...(fieldConfig.serial && {
              Serial: {
                Start: fieldConfig.serial.start,
                ...(fieldConfig.serial.maxValue && {
                  MaxValue: fieldConfig.serial.maxValue,
                }),
                ...(fieldConfig.serial.format && {
                  Format: fieldConfig.serial.format,
                }),
              },
            }),
          };

          if (fieldConfig.type === "nested") {
            fieldEntry.Type = "nested";
            delete fieldEntry.Vector;

            const objectField = type.fields[fieldName];
            if (objectField && (objectField as any).fields) {
              fieldEntry.Fields = TypeProcessor.processNestedFields(
                (objectField as any).fields,
              );
            }
          }

          fields[fieldName] = fieldEntry;
        });
    }

    const relationships: Record<string, any> = {};
    Object.entries(type.fields)
      .filter(([_, fieldConfig]: [string, any]) => fieldConfig.reference)
      .forEach(([fieldName, fieldConfig]: [string, any]) => {
        if (fieldConfig.reference) {
          const ref = fieldConfig.reference;
          const nameMap = ref.nameMap || [];
          if (nameMap.length > 0) {
            relationships[nameMap[0]] = {
              RefType: ref.type.name,
              RefField: ref.key || "id",
              SrcField: fieldName,
              Array: fieldConfig._metadata?.array || false,
              Description: ref.type.metadata.description || "",
            };
          }
        }
      });

    if (type.referenced && Object.keys(type.referenced).length > 0) {
      Object.entries(type.referenced).forEach(
        ([backwardFieldName, [referencedType, fieldName]]) => {
          const field = referencedType.fields[fieldName];
          const nameMap = field.reference?.nameMap;
          const array = !(field.metadata?.unique ?? false);
          const key = nameMap[1] || backwardFieldName;
          const srcField = field.reference?.key;
          relationships[key] = {
            RefType: referencedType.name,
            RefField: fieldName,
            SrcField: srcField || "id",
            Array: array,
            Description: referencedType.metadata.schema?.description || "",
          };
        },
      );
    }

    // Process indexes from metadata
    const indexes: Record<string, any> = {};
    if (schema?.indexes) {
      Object.entries(schema.indexes).forEach(([key, index]) => {
        indexes[key] = {
          FieldNames: index.fields,
          Unique: index.unique || false,
        };
      });
    }

    const permissions = schema.permissions?.record
      ? TypeProcessor.convertPermissionsToManifest(schema.permissions.record)
      : undefined;

    return {
      Name: metadata.name || type.name,
      Description: schema?.description || "",
      Fields: fields,
      Relationships: relationships,
      Settings: defaultSettings,
      Extends: schema?.extends || false,
      Directives: [],
      Indexes: indexes,
      ...(permissions
        ? { Permission: permissions }
        : { TypePermission: defaultTypePermission }),
    };
  }

  static convertPermissionsToManifest(
    permission: StandardTailorTypePermission,
  ): StandardTailorTypePermission {
    return Object.keys(permission).reduce((acc, key) => {
      acc[capitalize(key)] = TypeProcessor.convertPermissionItems(
        (permission as any)[key],
      );
      return acc;
    }, {} as any);
  }

  static convertOperand(operand: PermissionOperand, keys: readonly string[]) {
    if (typeof operand === "object" && !Array.isArray(operand)) {
      const foundKey = keys.find((key) => key in operand);

      if (foundKey) {
        return {
          Kind: foundKey,
          Value: (operand as Record<string, string>)[foundKey],
        };
      }
    }

    return {
      Kind: "value",
      Value: operand,
    };
  }

  static convertPermissionItems(
    items: StandardTailorTypePermission[keyof StandardTailorTypePermission],
  ): any[] {
    return items.map((item) => ({
      Conditions: item.conditions.map((cond: any) =>
        TypeProcessor.convertCondition(cond),
      ),
      Permit: item.permit,
      Description: item.description,
    }));
  }

  static convertCondition(condition: any): any {
    const [left, operator, right] = condition;

    const leftOperand = TypeProcessor.convertOperand(left, recordOperandKeys);
    const rightOperand = TypeProcessor.convertOperand(right, recordOperandKeys);
    return {
      [`Left${capitalize(leftOperand.Kind)}`]: leftOperand,
      Operator: operator,
      [`Right${capitalize(rightOperand.Kind)}`]: rightOperand,
    };
  }

  static async processType(type: TailorDBType): Promise<ManifestTypeMetadata> {
    const fields: ManifestFieldMetadata[] = Object.entries(type.fields).map(
      ([fieldName, fieldDef]) => {
        const typedFieldDef = fieldDef as any;
        const metadata = typedFieldDef.metadata;
        const fieldMetadata: ManifestFieldMetadata = {
          name: fieldName,
          description: metadata.description || "",
          type:
            tailorToManifestScalar[
              metadata.type as keyof typeof tailorToManifestScalar
            ] || "string",
          required: metadata.required ?? true,
          array: metadata.array ?? false,
        };

        if (metadata.type === "nested") {
          if (typedFieldDef.fields) {
            const objectFields = typedFieldDef.fields;
            const nestedFields =
              TypeProcessor.processNestedFields(objectFields);
            (fieldMetadata as any).Fields = nestedFields;
            fieldMetadata.type = "nested";
          }
        }

        return fieldMetadata;
      },
    );

    const typeManifest = TypeProcessor.generateTailorDBTypeManifest(type);

    // Process GQL permissions if defined
    let gqlPermissionManifest: GQLPermissionManifest | undefined = undefined;
    const gqlPermission = type.metadata.schema?.permissions?.gql;
    if (gqlPermission) {
      const manifest = TypeProcessor.convertGqlPermissionToManifest(
        type.name,
        gqlPermission,
      );
      gqlPermissionManifest = manifest ?? undefined;
    }

    return {
      name: type.name,
      fields,
      isInput: false,
      typeManifest,
      gqlPermissionManifest,
    };
  }

  static async processTypes(
    types: TailorDBType[],
  ): Promise<Record<string, ManifestTypeMetadata>> {
    const result: Record<string, ManifestTypeMetadata> = {};

    for (const type of types) {
      const metadata = await this.processType(type);
      result[type.name] = metadata;
    }

    return result;
  }

  static convertGqlPermissionToManifest(
    typeName: string,
    permission: readonly StandardGqlPermissionPolicy[],
  ): GQLPermissionManifest | null {
    // New format: permission is already an array of policies
    if (!Array.isArray(permission) || permission.length === 0) {
      return null;
    }

    const policies: GQLPermissionPolicyManifest[] = permission.map(
      (policy: StandardGqlPermissionPolicy) =>
        ({
          ...(policy.conditions && {
            Conditions: policy.conditions.map((cond: any) =>
              TypeProcessor.convertGqlCondition(cond),
            ),
          }),
          Actions: policy.actions,
          Permit: (policy.permit ?? true) ? "allow" : "deny",
          ...(policy.description && { Description: policy.description }),
        }) as GQLPermissionPolicyManifest,
    );

    return {
      Type: typeName,
      Policies: policies,
    };
  }

  static convertGqlCondition(condition: any): GQLPermissionConditionManifest {
    const [left, operator, right] = condition;

    const leftOperand = TypeProcessor.convertOperand(left, gqlOperandKeys);
    const rightOperand = TypeProcessor.convertOperand(right, gqlOperandKeys);
    return {
      [`Left${capitalize(leftOperand.Kind)}`]: leftOperand,
      Operator: operator,
      [`Right${capitalize(rightOperand.Kind)}`]: rightOperand,
    };
  }
}
