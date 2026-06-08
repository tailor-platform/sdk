import type { DefinedFieldMetadata, FieldMetadata } from "./field-types";
import type { Prettify } from "./helpers";
import type {
  DBFieldMetadata as DBFieldMetadataGenerated,
  GqlOperationsInput,
  RawPermissions,
} from "./tailordb.generated";

export type SerialConfig<T extends "string" | "integer" = "string" | "integer"> = Prettify<
  {
    start: number;
    maxValue?: number;
  } & (T extends "string"
    ? {
        format?: string;
      }
    : object)
>;

export interface DBFieldMetadata extends FieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: string;
  foreignKeyField?: string;
  /** Lifecycle hooks for the field */
  hooks?: DBFieldMetadataGenerated["hooks"];
  serial?: SerialConfig;
  relation?: boolean;
  scale?: number;
}

export interface DefinedDBFieldMetadata extends DefinedFieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: boolean;
  validate?: boolean;
  hooks?: {
    create: boolean;
    update: boolean;
  };
  serial?: boolean;
  relation?: boolean;
}

export type GqlOperationsConfig = GqlOperationsInput;

export interface RawRelationConfig {
  type: "1-1" | "n-1" | "keyOnly" | "oneToOne" | "manyToOne" | "N-1";
  toward: {
    type: string;
    as?: string;
    key?: string;
  };
  backward?: string;
}

export interface TailorDBTypeMetadata {
  name: string;
  description?: string;
  settings?: {
    pluralForm?: string;
    aggregation?: boolean;
    bulkUpsert?: boolean;
    gqlOperations?: GqlOperationsConfig;
    publishEvents?: boolean;
  };
  permissions: RawPermissions;
  files: Record<string, string>;
  indexes?: Record<
    string,
    {
      fields: string[];
      unique?: boolean;
    }
  >;
}
