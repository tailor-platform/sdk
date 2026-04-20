import type { EnumValue } from "@/types/field-types";

export type AllowedValues = readonly [string | EnumValue, ...(string | EnumValue)[]];

/**
 * Normalize allowed values into EnumValue objects with descriptions.
 * @param values - Allowed values as strings or EnumValue objects
 * @returns Normalized allowed values
 */
export function mapAllowedValues(values: AllowedValues): EnumValue[] {
  return values.map((value) => {
    if (typeof value === "string") {
      return { value, description: "" };
    }
    return { ...value, description: value.description ?? "" };
  });
}

export type AllowedValuesOutput<V extends AllowedValues> = V[number] extends infer T
  ? T extends string
    ? T
    : T extends { value: infer K }
      ? K
      : never
  : never;
