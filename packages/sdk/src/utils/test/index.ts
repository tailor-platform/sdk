import type { output } from "#/configure/index";
import type { TailorDBType } from "#/configure/services/tailordb/schema";
import type { TailorField } from "#/configure/types/type";
import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Options for {@link createTailorDBHook}.
 */
export type CreateTailorDBHookOptions = {
  /**
   * Run the type's `validate` and throw on the first issue it reports. Turn it
   * off to compute the create-time values of a record that is not complete yet.
   * Defaults to `true`.
   */
  validate?: boolean;
};

/**
 * Creates a hook function that processes TailorDB type fields
 * - Uses existing id from data if provided, otherwise generates UUID for id fields
 * - Recursively processes nested types
 * - Executes hooks.create for fields with create hooks
 * @template T - The output type of the hook function
 * @param type - TailorDB type definition
 * @param options - Hook options
 * @returns A function that transforms input data according to field hooks
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTailorDBHook<T extends TailorDBType<any, any>>(
  type: T,
  options: CreateTailorDBHookOptions = {},
) {
  const { validate = true } = options;
  return (data: unknown, now: Date = new Date()) => {
    const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
    const hooked = Object.entries(type.fields).reduce(
      (hooked, [key, value]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const field = value as TailorField<any, any, any>;
        if (key === "id") {
          hooked[key] = obj?.[key] ?? crypto.randomUUID();
        } else if (field.type === "nested") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nestedHook = createTailorDBHook({ fields: field.fields } as any, options);
          if (field.metadata.array) {
            const nestedValue = obj?.[key];
            hooked[key] = Array.isArray(nestedValue)
              ? nestedValue.map((item) => nestedHook(item, now))
              : nestedValue;
          } else {
            hooked[key] = nestedHook(obj?.[key], now);
          }
        } else if (field.metadata.hooks?.create) {
          hooked[key] = field.metadata.hooks.create({
            input: obj?.[key],
            invoker: null,
            now,
          });
          if (hooked[key] instanceof Date) {
            hooked[key] = hooked[key].toISOString();
          }
        } else if (obj) {
          hooked[key] = obj[key];
        }
        if (hooked[key] == null && field.metadata.default !== undefined) {
          const isTimeType =
            field.type === "datetime" || field.type === "date" || field.type === "time";
          hooked[key] =
            field.metadata.default === "now" && isTimeType
              ? now.toISOString()
              : field.metadata.default;
        }
        return hooked;
      },
      {} as Record<string, unknown>,
    );

    // oxlint-disable-next-line typescript/no-unnecessary-condition -- metadata absent in recursive nested calls
    if (type.metadata?.typeHook?.create) {
      const { id: _id, ...typeHookInput } = hooked;
      // oxlint-disable-next-line typescript/no-unsafe-function-type
      const overrides = (type.metadata.typeHook.create as Function)({
        input: typeHookInput,
        invoker: null,
        now,
      });
      if (overrides && typeof overrides === "object") {
        for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
          hooked[key] = value instanceof Date ? value.toISOString() : value;
        }
      }
    }

    // oxlint-disable-next-line typescript/no-unnecessary-condition -- metadata absent in recursive nested calls
    if (validate && type.metadata?.typeValidate) {
      const { id: _id, ...newRecord } = hooked;
      // oxlint-disable-next-line typescript/no-unsafe-function-type
      (type.metadata.typeValidate as Function)(
        { newRecord, oldRecord: null, invoker: null },
        (field: string, message: string) => {
          throw new Error(`Validation failed on field '${field}': ${message}`);
        },
      );
    }

    return hooked as Partial<output<T>>;
  };
}

/**
 * Creates the standard schema definition for lines-db
 * This returns the first argument for defineSchema with the ~standard section
 * @template T - The output type after validation
 * @param schemaType - TailorDB field schema for validation
 * @param hook - Hook function to transform data before validation
 * @returns Schema object with ~standard section for defineSchema
 */
export function createStandardSchema<T = Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schemaType: TailorField<any, T>,
  hook: (data: unknown) => Partial<T>,
) {
  return {
    "~standard": {
      version: 1,
      vendor: "@tailor-platform/sdk",
      validate: (value: unknown) => {
        const hooked = hook(value);
        const result = schemaType.parse({
          value: hooked,
          data: hooked,
          invoker: null,
        });
        if (result.issues) {
          return result;
        }
        return { value: hooked as T };
      },
    },
  } as const satisfies StandardSchemaV1<T>;
}
