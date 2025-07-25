import { Script, EnumValue } from "@/types/types";

export const OperationType = {
  FUNCTION: 2,
  GRAPHQL: 3,
  SQL: 4,
} as const;

export type OperationType = (typeof OperationType)[keyof typeof OperationType];

export interface OperatorValidateConfig {
  script: Script;
  errorMessage: string;
}

export interface OperatorFieldHook {
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
  validate?: OperatorValidateConfig[];
  hooks?: OperatorFieldHook;
  assertNonNull?: boolean;
  serial?: {
    start: number;
    maxValue?: number;
    format?: string;
  };
}
