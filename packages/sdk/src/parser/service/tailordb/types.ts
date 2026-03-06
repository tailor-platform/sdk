export type { TypeSourceInfo } from "./type-parser";

// Re-exports from configure layer
export type {
  TailorAnyDBField,
  TailorAnyDBType,
  TailorDBField,
  DBFieldMetadata,
  Hook,
  TailorTypePermission,
  TailorTypeGqlPermission,
} from "@/configure/services/tailordb";

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
