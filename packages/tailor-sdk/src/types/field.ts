import { TailorDBType_Value } from "@tailor-inc/operator-client";

export type AllowedValue = InstanceType<typeof TailorDBType_Value>;

interface AllowedValueObject {
  value: string;
  description?: string;
}

type AllowedValueAlias = string | [string] | [string, string];

export type AllowedValues =
  | [AllowedValueAlias, ...AllowedValueAlias[]]
  | [AllowedValueObject, ...AllowedValueObject[]];

export function mapAllowedValues(values: AllowedValues): AllowedValue[] {
  return (
    values
      ?.map((value) => {
        if (typeof value === "string") {
          return { value };
        }
        if (Array.isArray(value)) {
          return { value: value[0], description: value[1] };
        }
        return value;
      })
      .map((value) => new TailorDBType_Value(value)) ?? []
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
