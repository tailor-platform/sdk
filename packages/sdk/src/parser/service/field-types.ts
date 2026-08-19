import type { TailorFieldType } from "#/configure/types/field.types";
import type { UnionToTuple } from "type-fest";

const tailorFieldTypes: Record<TailorFieldType, true> = {
  uuid: true,
  string: true,
  boolean: true,
  integer: true,
  float: true,
  decimal: true,
  enum: true,
  date: true,
  datetime: true,
  time: true,
  nested: true,
};

export const tailorFieldTypeKeys = Object.keys(tailorFieldTypes) as UnionToTuple<TailorFieldType>;
