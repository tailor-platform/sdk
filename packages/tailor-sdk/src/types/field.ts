import { EnumValue } from "@/types/types";

export type AllowedValue = EnumValue;

type AllowedValueAlias =
  | string
  | [string]
  | [string, string]
  | readonly [string]
  | readonly [string, string];

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
      if (
        Array.isArray(value) ||
        (value && typeof value === "object" && "length" in value)
      ) {
        const arr = value as readonly [string] | readonly [string, string];
        return { value: arr[0], description: arr[1] || "" };
      }
      const enumValue = value as EnumValue;
      return { ...enumValue, description: enumValue.description || "" };
    }) ?? []
  );
}

export type AllowedValuesOutput<V extends AllowedValues> =
  V[number] extends string
    ? V[number]
    : V[number] extends [infer K, ...unknown[]]
      ? K
      : V[number] extends { value: infer K }
        ? K
        : never;
