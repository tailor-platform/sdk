import type { output } from "#/configure/index";
import type { TailorDBType } from "#/configure/services/tailordb/schema";
import type { TailorField } from "#/configure/types/type";
import type { StandardSchemaV1 } from "@standard-schema/spec";

// Not `record[key] = value`: assigning to `__proto__` goes through the inherited
// setter, which mutates the prototype instead of recording the field and leaves
// no own property behind for the value to be read from.
function setField(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Creates a hook function that processes TailorDB table fields
 * - Uses existing id from data if provided, otherwise generates UUID for id fields
 * - Recursively processes nested types
 * - Executes hooks.create for fields with create hooks
 * - Takes each field from the data's own properties, so a field named after a
 *   member of `Object` such as `toString` is read from the record rather than
 *   from the prototype
 * @template T - The output type of the hook function
 * @param type - TailorDB table definition
 * @returns A function that transforms input data according to field hooks
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTailorDBHook<T extends TailorDBType<any, any>>(type: T) {
  return (data: unknown, now: Date = new Date()) => {
    const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
    const hooked = Object.entries(type.fields).reduce(
      (hooked, [key, value]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const field = value as TailorField<any, any, any>;
        // `Object.hasOwn`, not `obj?.[key]`: a field named after an Object member
        // such as `toString` would otherwise read the inherited value.
        const input = obj && Object.hasOwn(obj, key) ? obj[key] : undefined;
        let hookedValue: unknown;
        if (key === "id") {
          hookedValue = input ?? crypto.randomUUID();
        } else if (field.type === "nested") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nestedHook = createTailorDBHook({ fields: field.fields } as any);
          if (field.metadata.array) {
            hookedValue = Array.isArray(input) ? input.map((item) => nestedHook(item, now)) : input;
          } else {
            hookedValue = nestedHook(input, now);
          }
        } else if (field.metadata.hooks?.create) {
          hookedValue = field.metadata.hooks.create({ input, invoker: null, now });
          if (hookedValue instanceof Date) {
            hookedValue = hookedValue.toISOString();
          }
        } else {
          hookedValue = input;
        }
        if (hookedValue == null && field.metadata.default !== undefined) {
          const isTimeType =
            field.type === "datetime" || field.type === "date" || field.type === "time";
          hookedValue =
            field.metadata.default === "now" && isTimeType
              ? now.toISOString()
              : field.metadata.default;
        }
        // Set even when there is no value: the key carrying `undefined` is what
        // tells a schema inferred from the record that the column is nullable,
        // and it shadows a same-named member of `Object.prototype`.
        setField(hooked, key, hookedValue);
        return hooked;
      },
      {} as Record<string, unknown>,
    );

    // oxlint-disable-next-line typescript/no-unnecessary-condition -- metadata absent in recursive nested calls
    if (type.metadata?.typeHook?.create) {
      const { id: _id, ...typeHookInput } = hooked;
      // oxlint-disable-next-line typescript/no-unsafe-function-type
      const overrides = type.metadata.typeHook.create({
        input: typeHookInput,
        invoker: null,
        now,
      });
      if (overrides && typeof overrides === "object") {
        for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
          setField(hooked, key, value instanceof Date ? value.toISOString() : value);
        }
      }
    }

    return hooked as Partial<output<T>>;
  };
}

// Collect the issues the table's own `validate` reports for a record, so they
// surface the same way a field's do instead of ending the run.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function typeLevelIssues(type: TailorDBType<any, any> | undefined, hooked: unknown) {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- absent on a nested type
  const typeValidate = type?.metadata?.typeValidate;
  if (!typeValidate) {
    return [];
  }
  const { id: _id, ...newRecord } = hooked as Record<string, unknown>;
  const issues: StandardSchemaV1.Issue[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-function-type
  typeValidate({ newRecord, oldRecord: null, invoker: null }, (field: string, message: string) => {
    issues.push({ message, path: [field] });
  });
  return issues;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DeclaredFields = Record<string, TailorField<any, any, any>>;

function undeclaredFieldMessage(key: string): string {
  return `Field "${key}" is not declared by the table. Remove it from the row, or add it to the table definition and run \`tailor generate\`.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Reads the raw row, not the hooked one: the hook only copies the declared fields,
// so an undeclared key is gone by the time the field schema runs.
function collectUndeclaredFieldIssues(
  value: unknown,
  fields: DeclaredFields,
  path: string[],
  issues: StandardSchemaV1.Issue[],
): void {
  if (!isRecord(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    // `Object.hasOwn`, not `key in fields`: a key such as `constructor` would
    // otherwise resolve to a member of `Object.prototype`.
    if (!Object.hasOwn(fields, key)) {
      issues.push({ message: undeclaredFieldMessage(key), path: path.concat(key) });
      continue;
    }
    const field = fields[key];
    if (field?.type !== "nested") {
      continue;
    }
    const nested = value[key];
    const nestedFields = field.fields as DeclaredFields;
    if (field.metadata.array) {
      if (Array.isArray(nested)) {
        nested.forEach((item, index) => {
          collectUndeclaredFieldIssues(item, nestedFields, path.concat(key, `[${index}]`), issues);
        });
      }
    } else {
      collectUndeclaredFieldIssues(nested, nestedFields, path.concat(key), issues);
    }
  }
}

/**
 * Creates the standard schema definition used to validate seed rows.
 * Runs the hook, then the table's own `validate`, and the field schema only when
 * that reported nothing, so both levels of validation report as issues rather
 * than by throwing. When the table is given, a key the row carries that the table
 * does not declare is reported as an issue as well, including keys inside nested
 * objects, so a row that no longer matches the table fails here instead of when
 * it is applied.
 * @template T - The output type after validation
 * @param schemaType - TailorDB field schema for validation
 * @param hook - Hook function to transform data before validation
 * @param type - TailorDB table definition; runs its table-level `validate` and
 *   rejects fields it does not declare
 * @returns Schema object with ~standard section for defineSchema
 */
export function createStandardSchema<T = Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schemaType: TailorField<any, T>,
  hook: (data: unknown) => Partial<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type?: TailorDBType<any, any>,
) {
  const validateHooked = (hooked: Partial<T>): StandardSchemaV1.Result<T> => {
    const issues = typeLevelIssues(type, hooked);
    if (issues.length > 0) {
      return { issues };
    }
    const result = schemaType.parse({
      value: hooked,
      data: hooked,
      invoker: null,
    });
    if (result.issues) {
      return result;
    }
    return { value: hooked as T };
  };

  return {
    "~standard": {
      version: 1,
      vendor: "@tailor-platform/sdk",
      validate: (value: unknown) => {
        const hooked = hook(value);
        const undeclared: StandardSchemaV1.Issue[] = [];
        if (type) {
          collectUndeclaredFieldIssues(value, type.fields as DeclaredFields, [], undeclared);
        }
        const result = validateHooked(hooked);
        const issues = [...undeclared, ...(result.issues ?? [])];
        return issues.length > 0 ? { issues } : result;
      },
    },
  } as const satisfies StandardSchemaV1<T>;
}
