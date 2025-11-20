/**
 * Type definitions for enum constants generation.
 */

export interface EnumValue {
  value: string;
  description?: string;
}

export interface EnumDefinition {
  name: string;
  values: EnumValue[];
  fieldDescription?: string;
}

export interface EnumConstantMetadata {
  name: string;
  enums: EnumDefinition[];
}

export interface EnumNamespaceMetadata {
  namespace: string;
  enums: EnumDefinition[];
}
