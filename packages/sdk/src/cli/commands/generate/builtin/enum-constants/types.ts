/**
 * Type definitions for enum constants generation.
 */

import type { EnumValue } from "@/parser/service/tailordb/types";

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
