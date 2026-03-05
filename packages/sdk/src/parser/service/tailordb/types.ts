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
} from "@/types/tailordb.generated";

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
} from "@/types/tailordb";

export { isPluginGeneratedType } from "@/types/tailordb";

// Legacy aliases - map zinfer names to original names
export type { DBFieldMetadata as DBFieldMetadataZinfer } from "@/types/tailordb.generated";

// TailorDBFieldOutput uses zinfer-generated types
import type {
  DBFieldMetadata as DBFieldMetadataGenerated,
  RawRelationConfig as RawRelationConfigGenerated,
} from "@/types/tailordb.generated";

export type TailorDBFieldOutput = {
  type: string;
  fields?: Record<string, TailorDBFieldOutput>;
  metadata: DBFieldMetadataGenerated;
  rawRelation?: RawRelationConfigGenerated;
};
