import type { output, TailorUser } from "@/configure";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { TailorField } from "@/configure/types/type";
import type { StandardSchemaV1 } from "@standard-schema/spec";

/** Represents an unauthenticated user in the Tailor platform. */
export const unauthenticatedTailorUser = {
  id: "00000000-0000-0000-0000-000000000000",
  type: "",
  workspaceId: "00000000-0000-0000-0000-000000000000",
  attributes: null,
  attributeList: [],
} as const satisfies TailorUser;

/**
 * Creates a hook function that processes TailorDB type fields
 * - Uses existing id from data if provided, otherwise generates UUID for id fields
 * - Recursively processes nested types
 * - Executes hooks.create for fields with create hooks
 *
 * @template T - The output type of the hook function
 * @param type - TailorDB type definition
 * @returns A function that transforms input data according to field hooks
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTailorDBHook<T extends TailorDBType<any, any>>(type: T) {
  return (data: unknown) => {
    return Object.entries(type.fields).reduce(
      (hooked, [key, value]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const field = value as TailorField<any, any, any>;
        if (key === "id") {
          // Use existing id from data if provided, otherwise generate new UUID
          const existingId =
            data && typeof data === "object"
              ? (data as Record<string, unknown>)[key]
              : undefined;
          hooked[key] = existingId ?? crypto.randomUUID();
        } else if (field.type === "nested") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          hooked[key] = createTailorDBHook({ fields: field.fields } as any)(
            (data as Record<string, unknown>)[key],
          );
        } else if (field.metadata.hooks?.create) {
          hooked[key] = field.metadata.hooks.create({
            value: (data as Record<string, unknown>)[key],
            data: data,
            user: unauthenticatedTailorUser,
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
    ) as Partial<output<T>>;
  };
}

/**
 * Creates the standard schema definition for lines-db
 * This returns the first argument for defineSchema with the ~standard section
 *
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
          user: unauthenticatedTailorUser,
        });
        if (result.issues) {
          return result;
        }
        return { value: hooked as T };
      },
    },
  } as const satisfies StandardSchemaV1<T>;
}
