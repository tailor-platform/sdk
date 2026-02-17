import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createWorkDirContext,
  expectEnumValues,
  expectFieldNames,
  expectFieldType,
  expectTimestamps,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("010-fix-broken-model", () => {
  const employeePath = path.join(workDir, "tailordb/employee.ts");

  test("tailordb/employee.ts exists", () => {
    expect(fs.existsSync(employeePath)).toBe(true);
  });

  test("employee is a named export", async () => {
    const mod = await importPath(employeePath);
    expect(mod.employee).toBeDefined();
  });

  test("employee model name is 'Employee' (not 'Employe')", async () => {
    const { employee } = await importPath(employeePath);
    expect(employee.name).toBe("Employee");
  });

  test("employee model has all required fields", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldNames(employee, [
      "id",
      "name",
      "department",
      "salary",
      "hireDate",
      "isActive",
      "createdAt",
      "updatedAt",
    ]);
  });

  test("name is a required string field", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldType(employee.fields.name, "string", { required: true });
  });

  test("department is an enum field (not string)", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldType(employee.fields.department, "enum", { required: true });
  });

  test("department enum has correct values", async () => {
    const { employee } = await importPath(employeePath);
    expectEnumValues(employee.fields.department, ["engineering", "sales", "marketing", "hr"]);
  });

  test("salary is a required integer field", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldType(employee.fields.salary, "integer", { required: true });
  });

  test("salary has validators", async () => {
    const { employee } = await importPath(employeePath);
    const validators = employee.fields.salary.metadata.validate;
    expect(validators).toBeDefined();
    expect(Array.isArray(validators)).toBe(true);
    expect(validators.length).toBeGreaterThanOrEqual(1);
  });

  test("salary validator rejects negative values", async () => {
    const { employee } = await importPath(employeePath);
    const [validatorFn] = employee.fields.salary.metadata.validate[0];
    expect(validatorFn({ value: -1 })).toBe(false);
  });

  test("salary validator accepts zero", async () => {
    const { employee } = await importPath(employeePath);
    const [validatorFn] = employee.fields.salary.metadata.validate[0];
    expect(validatorFn({ value: 0 })).toBe(true);
  });

  test("salary validator accepts positive values", async () => {
    const { employee } = await importPath(employeePath);
    const [validatorFn] = employee.fields.salary.metadata.validate[0];
    expect(validatorFn({ value: 50000 })).toBe(true);
  });

  test("hireDate is a required datetime field", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldType(employee.fields.hireDate, "datetime", { required: true });
  });

  test("isActive is an optional boolean field", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldType(employee.fields.isActive, "boolean", { required: false });
  });

  test("timestamps are present with correct types", async () => {
    const { employee } = await importPath(employeePath);
    expectTimestamps(employee);
  });
});
