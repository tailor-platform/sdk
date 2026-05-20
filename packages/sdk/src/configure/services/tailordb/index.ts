export {
  db,
  type TailorAnyDBField,
  type TailorAnyDBType,
  type TailorDBField,
  type TailorDBType,
} from "./schema";
export type { TailorDBInstance } from "./schema";
export { createTable, timestampFields } from "./createTable";
export {
  unsafeAllowAllTypePermission,
  unsafeAllowAllGqlPermission,
  type TailorTypePermission,
  type TailorTypeGqlPermission,
  type PermissionCondition,
} from "./permission";
export type { RecordHook, TypeFeatures } from "./types";
export type { TailorDBServiceConfig } from "@/types/tailordb.generated";
export type {
  DBFieldMetadata,
  GqlOperationsConfig,
  TailorDBMigrationConfig,
  TailorDBServiceInput,
} from "@/types/tailordb";
