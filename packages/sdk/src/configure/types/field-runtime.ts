import {
  isValidDateString,
  isValidDateTimeString,
  isValidDecimalString,
  isValidTimeString,
  isValidUUIDString,
} from "#/configure/types/field-format";
import type { FieldMetadata, TailorFieldType } from "#/configure/types/field.types";
import type { TailorPrincipal } from "#/runtime/types";
import type { StandardSchemaV1 } from "@standard-schema/spec";

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
  _parseInternal(args: FieldParseInternalArgs): StandardSchemaV1.Result<unknown>;
};

type FieldValidateValueArgs<T extends TailorFieldType> = {
  field: FieldRuntime<T>;
  value: unknown;
  data: unknown;
  invoker: TailorPrincipal | null;
  pathArray: string[];
};

type FieldParseRuntimeArgs<T extends TailorFieldType> = FieldParseInternalArgs & {
  field: FieldRuntime<T>;
};

function validateValue<T extends TailorFieldType>(
  args: FieldValidateValueArgs<T>,
): StandardSchemaV1.Issue[] {
  const { field, value, data, invoker, pathArray } = args;
  const issues: StandardSchemaV1.Issue[] = [];
  const path = pathArray.length > 0 ? pathArray : undefined;

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
      if (typeof value !== "string" || !isValidUUIDString(value)) {
        issues.push({
          message: `Expected a valid UUID: received ${String(value)}`,
          path,
        });
      }
      break;
    case "date":
      if (typeof value !== "string" || !isValidDateString(value)) {
        issues.push({
          message: `Expected to match "yyyy-MM-dd" format: received ${String(value)}`,
          path,
        });
      }
      break;
    case "datetime":
      if (typeof value !== "string" || !isValidDateTimeString(value)) {
        issues.push({
          message: `Expected to match ISO format: received ${String(value)}`,
          path,
        });
      }
      break;
    case "time":
      if (typeof value !== "string" || !isValidTimeString(value)) {
        issues.push({
          message: `Expected to match "HH:mm" format: received ${String(value)}`,
          path,
        });
      }
      break;
    case "decimal":
      if (typeof value !== "string" || !isValidDecimalString(value)) {
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
      } else if (Object.keys(field.fields).length > 0) {
        for (const [fieldName, nestedField] of Object.entries(field.fields)) {
          const fieldValue = (value as Record<string, unknown>)[fieldName];
          const result = nestedField._parseInternal({
            value: fieldValue,
            data,
            invoker,
            pathArray: pathArray.concat(fieldName),
          });
          if (result.issues) {
            issues.push(...result.issues);
          }
        }
      }
      break;
  }

  const validateFns = field._metadata.validate;
  if (validateFns && validateFns.length > 0) {
    for (const validateInput of validateFns) {
      const { fn, message } =
        typeof validateInput === "function"
          ? { fn: validateInput, message: "Validation failed" }
          : { fn: validateInput[0], message: validateInput[1] };

      if (!fn({ value, data, invoker })) {
        issues.push({
          message,
          path,
        });
      }
    }
  }

  return issues;
}

export function parseInternal<T extends TailorFieldType, Output>(
  args: FieldParseRuntimeArgs<T>,
): StandardSchemaV1.Result<Output> {
  const { field, value, data, invoker, pathArray } = args;
  const issues: StandardSchemaV1.Issue[] = [];
  const path = pathArray.length > 0 ? pathArray : undefined;

  const isNullOrUndefined = value === null || value === undefined;
  if (field._metadata.required && isNullOrUndefined) {
    issues.push({
      message: "Required field is missing",
      path,
    });
    return { issues };
  }

  if (!field._metadata.required && isNullOrUndefined) {
    return { value: (value ?? null) as Output };
  }

  if (field._metadata.array) {
    if (!Array.isArray(value)) {
      issues.push({
        message: "Expected an array",
        path,
      });
      return { issues };
    }

    for (let i = 0; i < value.length; i++) {
      const elementValue = value[i];
      const elementPath = pathArray.concat(`[${i}]`);

      const elementIssues = validateValue({
        field,
        value: elementValue,
        data,
        invoker,
        pathArray: elementPath,
      });
      if (elementIssues.length > 0) {
        issues.push(...elementIssues);
      }
    }

    if (issues.length > 0) {
      return { issues };
    }
    return { value: value as Output };
  }

  const valueIssues = validateValue({ field, value, data, invoker, pathArray });
  issues.push(...valueIssues);

  if (issues.length > 0) {
    return { issues };
  }

  return { value: value as Output };
}
