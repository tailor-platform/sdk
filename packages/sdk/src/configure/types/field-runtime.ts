import type { FieldMetadata, TailorFieldType } from "#/configure/types/field.types";
import type { TailorUser } from "#/runtime/types";
import type { StandardSchemaV1 } from "@standard-schema/spec";

const regex = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
  time: /^(?<hour>\d{2}):(?<minute>\d{2})$/,
  datetime:
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(.(?<millisec>\d{3}))?Z$/,
  decimal: /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/,
} as const;

export type FieldParseArgs = {
  value: unknown;
  data: unknown;
  user: TailorUser;
};

export type FieldParseInternalArgs = {
  value: unknown;
  data: unknown;
  user: TailorUser;
  pathArray: string[];
};

export type FieldRuntime<T extends TailorFieldType = TailorFieldType> = {
  readonly type: T;
  readonly fields: Record<string, FieldRuntime>;
  _metadata: FieldMetadata;
  _parseInternal(args: FieldParseInternalArgs): StandardSchemaV1.Result<unknown>;
};

type FieldValidateValueArgs<T extends TailorFieldType> = {
  field: FieldRuntime<T>;
  value: unknown;
  data: unknown;
  user: TailorUser;
  pathArray: string[];
};

type FieldParseRuntimeArgs<T extends TailorFieldType> = FieldParseInternalArgs & {
  field: FieldRuntime<T>;
};

type FieldValidationResult = {
  issues: StandardSchemaV1.Issue[];
  baseValid: boolean;
};

function validateBaseValue<T extends TailorFieldType>(
  args: FieldValidateValueArgs<T>,
): FieldValidationResult {
  const { field, value, data, user, pathArray } = args;
  const issues: StandardSchemaV1.Issue[] = [];
  const path = pathArray.length > 0 ? pathArray : undefined;
  let baseValid = true;

  switch (field.type) {
    case "string":
      if (typeof value !== "string") {
        issues.push({
          message: `Expected a string: received ${String(value)}`,
          path,
        });
        baseValid = false;
      }
      break;

    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        issues.push({
          message: `Expected an integer: received ${String(value)}`,
          path,
        });
        baseValid = false;
      }
      break;

    case "float":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push({
          message: `Expected a number: received ${String(value)}`,
          path,
        });
        baseValid = false;
      }
      break;

    case "boolean":
      if (typeof value !== "boolean") {
        issues.push({
          message: `Expected a boolean: received ${String(value)}`,
          path,
        });
        baseValid = false;
      }
      break;

    case "uuid":
      if (typeof value !== "string" || !regex.uuid.test(value)) {
        issues.push({
          message: `Expected a valid UUID: received ${String(value)}`,
          path,
        });
        baseValid = false;
      }
      break;
    case "date":
      if (typeof value !== "string" || !regex.date.test(value)) {
        issues.push({
          message: `Expected to match "yyyy-MM-dd" format: received ${String(value)}`,
          path,
        });
        baseValid = false;
      }
      break;
    case "datetime":
      if (typeof value !== "string" || !regex.datetime.test(value)) {
        issues.push({
          message: `Expected to match ISO format: received ${String(value)}`,
          path,
        });
        baseValid = false;
      }
      break;
    case "time":
      if (typeof value !== "string" || !regex.time.test(value)) {
        issues.push({
          message: `Expected to match "HH:mm" format: received ${String(value)}`,
          path,
        });
        baseValid = false;
      }
      break;
    case "decimal":
      if (typeof value !== "string" || !regex.decimal.test(value)) {
        issues.push({
          message: `Expected a decimal string: received ${String(value)}`,
          path,
        });
        baseValid = false;
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
          baseValid = false;
        }
      }
      break;

    case "nested":
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
        baseValid = false;
      } else if (Object.keys(field.fields).length > 0) {
        for (const [fieldName, nestedField] of Object.entries(field.fields)) {
          const fieldValue = (value as Record<string, unknown>)[fieldName];
          const result = validateField({
            field: nestedField,
            value: fieldValue,
            data,
            user,
            pathArray: pathArray.concat(fieldName),
          });
          if (result.issues.length > 0) {
            issues.push(...result.issues);
          }
          if (!result.baseValid) {
            baseValid = false;
          }
        }
      }
      break;
  }

  return { issues, baseValid };
}

function validateCustomValue<T extends TailorFieldType>(
  args: FieldValidateValueArgs<T>,
): StandardSchemaV1.Issue[] {
  const { field, value, data, user, pathArray } = args;
  const issues: StandardSchemaV1.Issue[] = [];
  const path = pathArray.length > 0 ? pathArray : undefined;

  const validateFns = field._metadata.validate;
  if (validateFns && validateFns.length > 0) {
    for (const validateInput of validateFns) {
      const { fn, message } =
        typeof validateInput === "function"
          ? { fn: validateInput, message: "Validation failed" }
          : { fn: validateInput[0], message: validateInput[1] };

      if (!fn({ value, data, user })) {
        issues.push({
          message,
          path,
        });
      }
    }
  }

  return issues;
}

function validateField<T extends TailorFieldType>(
  args: FieldValidateValueArgs<T>,
): FieldValidationResult {
  const { field, value, pathArray } = args;
  const issues: StandardSchemaV1.Issue[] = [];
  const path = pathArray.length > 0 ? pathArray : undefined;

  const isNullOrUndefined = value === null || value === undefined;
  if (field._metadata.required && isNullOrUndefined) {
    issues.push({
      message: "Required field is missing",
      path,
    });
    return { issues, baseValid: false };
  }

  if (!field._metadata.required && isNullOrUndefined) {
    return { issues, baseValid: true };
  }

  let baseValid = true;
  if (field._metadata.array) {
    if (!Array.isArray(value)) {
      issues.push({
        message: "Expected an array",
        path,
      });
      return { issues, baseValid: false };
    }

    for (let i = 0; i < value.length; i++) {
      const result = validateBaseValue({
        ...args,
        value: value[i],
        pathArray: pathArray.concat(`[${i}]`),
      });
      issues.push(...result.issues);
      if (!result.baseValid) {
        baseValid = false;
      }
    }
  } else {
    const result = validateBaseValue(args);
    issues.push(...result.issues);
    baseValid = result.baseValid;
  }

  if (baseValid && field._metadata.validate?.length) {
    issues.push(...validateCustomValue(args));
  }

  return { issues, baseValid };
}

export function parseInternal<T extends TailorFieldType, Output>(
  args: FieldParseRuntimeArgs<T>,
): StandardSchemaV1.Result<Output> {
  const { value } = args;
  const { issues } = validateField(args);
  if (issues.length > 0) {
    return { issues };
  }

  return { value: (value ?? null) as Output };
}
