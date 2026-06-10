export type TailorDbErdSource = "local";

export interface TailorDbErdTypeSource {
  kind: "user" | "plugin";
  exportName?: string;
  pluginId?: string;
  pluginImportPath?: string;
  originalExportName?: string;
  generatedTypeKind?: string;
  namespace?: string;
}

export interface TailorDbErdColumnRelation {
  targetTable: string;
  targetColumn: string;
  kind: "foreignKey" | "relation";
  required: boolean;
  relationType?: string;
  forwardName?: string;
  backwardName?: string;
}

export interface TailorDbErdColumn {
  name: string;
  type: string;
  required: boolean;
  array: boolean;
  description?: string;
  primaryKey?: boolean;
  unique?: boolean;
  index?: boolean;
  indexNames?: string[];
  uniqueIndexNames?: string[];
  enumValues?: string[];
  enumValueDescriptions?: Record<string, string>;
  vector?: boolean;
  serial?: {
    start: number;
    maxValue?: number;
    format?: string;
  };
  scale?: number;
  validations?: number;
  hooks?: {
    create?: boolean;
    update?: boolean;
  };
  fields?: TailorDbErdColumn[];
  relation?: TailorDbErdColumnRelation;
}

export interface TailorDbErdIndex {
  name: string;
  fields: string[];
  unique: boolean;
}

export interface TailorDbErdRelationship {
  name: string;
  targetType: string;
  targetField: string;
  sourceField: string;
  isArray: boolean;
  description?: string;
}

export interface TailorDbErdTable {
  name: string;
  pluralForm: string;
  description?: string;
  source?: TailorDbErdTypeSource;
  columns: TailorDbErdColumn[];
  indexes: TailorDbErdIndex[];
  forwardRelationships: TailorDbErdRelationship[];
  backwardRelationships: TailorDbErdRelationship[];
}

export interface TailorDbErdRelation {
  name: string;
  sourceTable: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
  required: boolean;
  unique: boolean;
  kind: "foreignKey" | "relation";
  relationType?: string;
  forwardName?: string;
  backwardName?: string;
}

export interface TailorDbErdSchema {
  version: 1;
  namespace: string;
  generatedAt: string;
  revision: string;
  source: TailorDbErdSource;
  cleanRoom: {
    implementation: "tailor-sdk";
    notes: string[];
  };
  tables: TailorDbErdTable[];
  relations: TailorDbErdRelation[];
}
