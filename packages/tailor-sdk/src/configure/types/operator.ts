import { type Script, type EnumValue } from "@/configure/types/types";

export const OperationType = {
  FUNCTION: 2,
  GRAPHQL: 3,
  SQL: 4,
} as const;

export type OperationType = (typeof OperationType)[keyof typeof OperationType];

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
  assertNonNull?: boolean;
  serial?: {
    start: number;
    maxValue?: number;
    format?: string;
  };
  fields?: Record<string, OperatorFieldConfig>;
}
