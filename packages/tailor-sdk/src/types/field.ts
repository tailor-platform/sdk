import { EnumValue } from "@/types/types";

export type AllowedValue = EnumValue;

type AllowedValueAlias = string | [string] | [string, string];

export type AllowedValues =
  | [AllowedValueAlias, ...AllowedValueAlias[]]
  | [EnumValue, ...EnumValue[]]
  | readonly [AllowedValueAlias, ...AllowedValueAlias[]]
  | readonly [EnumValue, ...EnumValue[]];

export function mapAllowedValues(values: AllowedValues): AllowedValue[] {
  return (
    values?.map((value) => {
      if (typeof value === "string") {
        return { value, description: "" };
      }
      if (Array.isArray(value)) {
        return { value: value[0], description: value[1] || "" };
      }
      return { ...value, description: value.description || "" };
    }) ?? []
  );
}

export type AllowedValuesOutput<V extends AllowedValues> =
  V[number] extends string
    ? V[number]
    : V[number] extends [infer K, ...any]
      ? K
      : V[number] extends { value: infer K }
        ? K
        : never;
