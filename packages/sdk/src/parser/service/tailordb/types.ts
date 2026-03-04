export type { TypeSourceInfo } from "./type-parser";

// Zinfer-generated types
export type {
  DBFieldMetadata as DBFieldMetadataOutput,
  RawRelationConfig as RawRelationConfigOutput,
  TailorDBTypeParsedSettingsInput,
  TailorDBTypeParsedSettings,
  RawPermissions,
  TailorDBTypeRawInput,
  TailorDBTypeRaw as TailorDBTypeSchemaOutput,
  TailorDBServiceConfigInput,
  TailorDBServiceConfig,
} from "@/types/tailordb";

// Re-exports from configure layer
export type {
  TailorAnyDBField,
  TailorAnyDBType,
  TailorDBField,
  DBFieldMetadata,
  Hook,
  TailorTypePermission,
  TailorTypeGqlPermission,
  GqlOperationsConfig,
  GqlOperations,
} from "@/configure/services/tailordb";

// Manual types
export type {
  TailorDBExternalConfig,
  TailorDBServiceInput,
  TailorDBMigrationConfig,
  UserDefinedTypeSource,
  PluginGeneratedTypeSource,
  TypeSourceInfoEntry,
  Script,
  EnumValue,
  RawRelationConfig,
  OperatorFieldConfig,
  PermissionOperand,
  StandardPermissionCondition,
  StandardActionPermission,
  StandardTailorTypePermission,
  StandardGqlPermissionPolicy,
  StandardTailorTypeGqlPermission,
  Permissions,
  TailorDBTypeMetadata,
  ParsedField,
  ParsedRelationship,
  TailorDBType,
} from "@/types/tailordb.manual";

export { isPluginGeneratedType } from "@/types/tailordb.manual";

// Legacy aliases - map zinfer names to original names
export type { DBFieldMetadata as DBFieldMetadataZinfer } from "@/types/tailordb";

// TailorDBFieldOutput uses zinfer-generated types
export type TailorDBFieldOutput = {
  type: string;
  fields?: Record<string, TailorDBFieldOutput>;
  metadata: import("@/types/tailordb").DBFieldMetadata;
  rawRelation?: import("@/types/tailordb").RawRelationConfig;
};
