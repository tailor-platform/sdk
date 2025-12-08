import type { TailorDBTypeConfig } from "@/configure/services/tailordb/operator-types";

// Script expression used in hooks and validators
export interface Script {
  expr: string;
}

// Enum value definition
export interface EnumValue {
  value: string;
  description?: string;
}

interface OperatorValidateConfig {
  script: Script;
  errorMessage: string;
}

interface OperatorFieldHook {
  create?: Script;
  update?: Script;
}

export interface OperatorFieldConfig {
  type: string;
  required?: boolean;
  description?: string;
  allowedValues?: EnumValue[];
  array?: boolean;
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: string;
  foreignKeyField?: string;
  validate?: OperatorValidateConfig[];
  hooks?: OperatorFieldHook;
  serial?: {
    start: number;
    maxValue?: number;
    format?: string;
  };
  fields?: Record<string, OperatorFieldConfig>;
}

/**
 * Parsed and normalized TailorDB field information
 */
export interface ParsedField {
  name: string;
  config: TailorDBTypeConfig["schema"]["fields"][string];
  // Relation information (if this field is a relation)
  relation?: {
    targetType: string;
    forwardName: string; // Always populated (generated via inflection if not provided)
    backwardName: string; // Always populated (generated via inflection if not provided)
    key: string;
    unique: boolean;
  };
}

/**
 * Parsed and normalized TailorDB relationship information
 */
export interface ParsedRelationship {
  name: string; // Relationship field name (forward or backward)
  targetType: string;
  targetField: string; // The field name in the source type that creates this relationship
  sourceField: string; // The field name in the target type (for foreign key)
  isArray: boolean;
  description: string;
}

/**
 * Parsed and normalized TailorDB type information
 */
export interface ParsedTailorDBType {
  name: string;
  // Normalized plural form (always populated via inflection if not provided)
  pluralForm: string;
  description?: string;
  fields: Record<string, ParsedField>;
  // Forward relationships (defined on this type)
  forwardRelationships: Record<string, ParsedRelationship>;
  // Backward relationships (defined on other types pointing to this type)
  backwardRelationships: Record<string, ParsedRelationship>;
  settings: TailorDBTypeConfig["schema"]["settings"];
  permissions: TailorDBTypeConfig["schema"]["permissions"];
  indexes?: TailorDBTypeConfig["schema"]["indexes"];
  files?: TailorDBTypeConfig["schema"]["files"];
}

/**
 * Parsed TailorDB namespace containing all types
 */
export interface ParsedTailorDBNamespace {
  namespace: string;
  types: Record<string, ParsedTailorDBType>;
}
