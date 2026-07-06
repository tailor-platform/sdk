import type { output } from "#/configure/index";
import type { TailorDBType } from "#/configure/services/tailordb/schema";
import type { TailorField } from "#/configure/types/type";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export {
  setupTailordbMock,
  setupTailorErrorsMock,
  setupWorkflowMock,
  setupInvokerMock,
  setupWaitPointMock,
  createImportMain,
} from "./mock";

/**
 * Creates a hook function that processes TailorDB type fields
 * - Uses existing id from data if provided, otherwise generates UUID for id fields
 * - Recursively processes nested types
 * - Executes hooks.create for fields with create hooks
 * @template T - The output type of the hook function
 * @param type - TailorDB type definition
 * @returns A function that transforms input data according to field hooks
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTailorDBHook<T extends TailorDBType<any, any>>(type: T) {
  return (data: unknown) => {
    const now = new Date();
    const hooked = Object.entries(type.fields).reduce(
      (hooked, [key, value]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const field = value as TailorField<any, any, any>;
        if (key === "id") {
          const existingId =
            data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
          hooked[key] = existingId ?? crypto.randomUUID();
        } else if (field.type === "nested") {
          const nestedValue =
            data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nestedHook = createTailorDBHook({ fields: field.fields } as any);
          if (field.metadata.array) {
            hooked[key] = Array.isArray(nestedValue)
              ? nestedValue.map((item) => nestedHook(item))
              : nestedValue;
          } else {
            hooked[key] = nestedHook(nestedValue);
          }
        } else if (field.metadata.hooks?.create) {
          hooked[key] = field.metadata.hooks.create({
            value: (data as Record<string, unknown>)[key],
            oldValue: null,
            invoker: null,
            now,
          });
          if (hooked[key] instanceof Date) {
            hooked[key] = hooked[key].toISOString();
          }
        } else if (data && typeof data === "object") {
          hooked[key] = (data as Record<string, unknown>)[key];
        }
        return hooked;
      },
      {} as Record<string, unknown>,
    );

    // oxlint-disable-next-line typescript/no-unnecessary-condition -- metadata absent in recursive nested calls
    if (type.metadata?.typeHook?.create) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      const overrides = (type.metadata.typeHook.create as Function)({
        input: data,
        oldRecord: null,
        invoker: null,
        now,
      });
      if (overrides && typeof overrides === "object") {
        for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
          hooked[key] = value instanceof Date ? value.toISOString() : value;
        }
      }
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
