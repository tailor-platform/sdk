import type { FieldMetadata, TailorFieldType } from "#/configure/types/field.types";
import type { TailorPrincipal } from "#/runtime/types";
import type { StandardSchemaV1 } from "@standard-schema/spec";

const regex = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
  time: /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/,
  datetime:
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[Tt](?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d):(?<second>[0-5]\d|60)(\.(?<fraction>\d+))?(?<offset>[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
  decimal: /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/,
} as const;

export type FieldParseArgs = {
  value: unknown;
  data: unknown;
  invoker: TailorPrincipal | null;
};

export type FieldParseInternalArgs = {
  value: unknown;
  data: unknown;
  invoker: TailorPrincipal | null;
  pathArray: string[];
};

export type FieldRuntime<T extends TailorFieldType = TailorFieldType> = {
  readonly type: T;
  readonly fields: Record<string, FieldRuntime>;
  _metadata: FieldMetadata;
};

type FieldParseRuntimeArgs<T extends TailorFieldType> = FieldParseInternalArgs & {
  field: FieldRuntime<T>;
};

type FieldValidationArgs<T extends TailorFieldType> = FieldParseRuntimeArgs<T> & {
  issues: StandardSchemaV1.Issue[];
};

function validateBaseValue<T extends TailorFieldType>(args: FieldValidationArgs<T>): boolean {
  const { field, value, pathArray, issues } = args;
  const path = pathArray.length > 0 ? pathArray : undefined;
  const initialIssueCount = issues.length;

  switch (field.type) {
    case "string":
      if (typeof value !== "string") {
        issues.push({
          message: `Expected a string: received ${String(value)}`,
          path,
        });
      }
      break;

    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        issues.push({
          message: `Expected an integer: received ${String(value)}`,
          path,
        });
      }
      break;

    case "float":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push({
          message: `Expected a number: received ${String(value)}`,
          path,
        });
      }
      break;

    case "boolean":
      if (typeof value !== "boolean") {
        issues.push({
          message: `Expected a boolean: received ${String(value)}`,
          path,
        });
      }
      break;

    case "uuid":
      if (typeof value !== "string" || !regex.uuid.test(value)) {
        issues.push({
          message: `Expected a valid UUID: received ${String(value)}`,
          path,
        });
      }
      break;
    case "date":
      if (typeof value !== "string" || !regex.date.test(value)) {
        issues.push({
          message: `Expected to match "yyyy-MM-dd" format: received ${String(value)}`,
          path,
        });
      }
      break;
    case "datetime":
      if (typeof value !== "string" || !regex.datetime.test(value)) {
        issues.push({
          message: `Expected to match ISO format: received ${String(value)}`,
          path,
        });
      }
      break;
    case "time":
      if (typeof value !== "string" || !regex.time.test(value)) {
        issues.push({
          message: `Expected to match "HH:mm" format: received ${String(value)}`,
          path,
        });
      }
      break;
    case "decimal":
      if (typeof value !== "string" || !regex.decimal.test(value)) {
        issues.push({
          message: `Expected a decimal string: received ${String(value)}`,
          path,
        });
      }
      break;

    case "enum":
      if (field._metadata.allowedValues) {
        const allowedValues = field._metadata.allowedValues.map((v) => v.value);
        if (typeof value !== "string" || !allowedValues.includes(value)) {
          issues.push({
            message: `Must be one of [${allowedValues.join(", ")}]: received ${String(value)}`,
            path,
          });
        }
      }
      break;

    case "nested": {
      // Runtime input may not match the declared field type.
      // oxlint-disable typescript/no-unnecessary-condition
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        value instanceof Date
      ) {
        // oxlint-enable typescript/no-unnecessary-condition
        issues.push({
          message: `Expected an object: received ${String(value)}`,
          path,
        });
        return false;
      }

      let nestedBaseValid = true;
      for (const [fieldName, nestedField] of Object.entries(field.fields)) {
        const fieldValue = (value as Record<string, unknown>)[fieldName];
        if (
          !validateBaseField({
            ...args,
            field: nestedField,
            value: fieldValue,
            pathArray: pathArray.concat(fieldName),
          })
        ) {
          nestedBaseValid = false;
        }
      }
      return nestedBaseValid;
    }
  }

  return issues.length === initialIssueCount;
}

function validateCustomValue<T extends TailorFieldType>(
  args: FieldValidationArgs<T>,
  validateFns: NonNullable<FieldMetadata["validate"]>,
): void {
  const { value, pathArray, issues } = args;
  const path = pathArray.length > 0 ? pathArray : undefined;

  for (const fn of validateFns) {
    const result = fn({ value });
    if (typeof result === "string") {
      issues.push({
        message: result,
        path,
      });
    }
  }
}

function validateBaseField<T extends TailorFieldType>(args: FieldValidationArgs<T>): boolean {
  const { field, value, pathArray, issues } = args;
  const path = pathArray.length > 0 ? pathArray : undefined;

  const isNullOrUndefined = value === null || value === undefined;
  if (field._metadata.required && isNullOrUndefined) {
    issues.push({
      message: "Required field is missing",
      path,
    });
    return false;
  }

  if (!field._metadata.required && isNullOrUndefined) {
    return true;
  }

  let baseValid = true;
  if (field._metadata.array) {
    if (!Array.isArray(value)) {
      issues.push({
        message: "Expected an array",
        path,
      });
      return false;
    }

    for (let i = 0; i < value.length; i++) {
      if (
        !validateBaseValue({
          ...args,
          value: value[i],
          pathArray: pathArray.concat(`[${i}]`),
        })
      ) {
        baseValid = false;
      }
    }
  } else {
    baseValid = validateBaseValue(args);
  }

  return baseValid;
}

function validateCustomField<T extends TailorFieldType>(args: FieldValidationArgs<T>): void {
  const { field, value, pathArray } = args;
  if (value === null || value === undefined) {
    return;
  }

  if (field.type === "nested") {
    const records = field._metadata.array
      ? (value as Record<string, unknown>[])
      : [value as Record<string, unknown>];

    for (let i = 0; i < records.length; i++) {
      const record = records[i] as Record<string, unknown>;
      const recordPath = field._metadata.array ? pathArray.concat(`[${i}]`) : pathArray;
      for (const [fieldName, nestedField] of Object.entries(field.fields)) {
        validateCustomField({
          ...args,
          field: nestedField,
          value: record[fieldName],
          pathArray: recordPath.concat(fieldName),
        });
      }
    }
  }

  const validateFns = field._metadata.validate;
  if (validateFns?.length) {
    validateCustomValue(args, validateFns);
  }
}

export function parseInternal<T extends TailorFieldType, Output>(
  args: FieldParseRuntimeArgs<T>,
): StandardSchemaV1.Result<Output> {
  const { value } = args;
  const issues: StandardSchemaV1.Issue[] = [];
  const validationArgs = { ...args, issues };
  const baseValid = validateBaseField(validationArgs);
  if (baseValid) {
    validateCustomField(validationArgs);
  }
  if (issues.length > 0) {
    return { issues };
  }

  return { value: (value ?? null) as Output };
}

type ParseInputFieldsArgs = FieldParseArgs & {
  fields: Record<string, FieldRuntime>;
};

/**
 * Validate a value against a record of input fields, treating the record as a
 * single required object — the same code path deployed functions run via
 * `t.object(fields).parse(...)`, so local validation matches platform behavior.
 * @param args - Input field definitions plus the value, context data, and user
 * @returns Validation result
 */
export function parseInputFields(args: ParseInputFieldsArgs): StandardSchemaV1.Result<unknown> {
  const { fields, ...parseArgs } = args;
  return parseInternal({
    ...parseArgs,
    field: { type: "nested", fields, _metadata: { required: true } },
    pathArray: [],
  });
}
