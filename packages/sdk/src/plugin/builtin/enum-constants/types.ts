/**
 * Type definitions for enum constants generation.
 */

import type { EnumValue } from "#src/configure/types/field.types";

export interface EnumDefinition {
  name: string;
  values: EnumValue[];
  fieldDescription?: string;
}

export interface EnumConstantMetadata {
  name: string;
  enums: EnumDefinition[];
}
