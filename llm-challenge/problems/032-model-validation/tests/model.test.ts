import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("032-model-validation", () => {
  const employeePath = path.join(workDir, "tailordb/employee.ts");

  test("tailordb/employee.ts exists", () => {
    expect(fs.existsSync(employeePath)).toBe(true);
  });

  test("employee is a named export", async () => {
    const mod = await import(employeePath);
    expect(mod.employee).toBeDefined();
  });

  test("employee model has correct name", async () => {
    const { employee } = await import(employeePath);
    expect(employee.name).toBe("Employee");
  });

  test("employee model has all required fields", async () => {
    const { employee } = await import(employeePath);
    const fieldNames = Object.keys(employee.fields);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("age");
    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("department");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("name is a required string field", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.name;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("age is a required integer field", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.age;
    expect(field.type).toBe("integer");
    expect(field.metadata.required).toBe(true);
  });

  test("email is a required string field", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.email;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("department is an enum field with correct values", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.department;
    expect(field.type).toBe("enum");
    expect(field.metadata.required).toBe(true);

    const values = field.metadata.allowedValues.map((v: { value: string }) => v.value);
    expect(values).toEqual(["engineering", "sales", "marketing", "hr"]);
  });

  test("timestamps are present with correct types", async () => {
    const { employee } = await import(employeePath);
    expect(employee.fields.createdAt.type).toBe("datetime");
    expect(employee.fields.updatedAt.type).toBe("datetime");
  });

  test("name field has validators", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.name;
    const validators = field.metadata.validate;
    expect(validators).toBeDefined();
    expect(Array.isArray(validators)).toBe(true);
    expect(validators.length).toBeGreaterThanOrEqual(1);
  });

  test("age field has at least 2 validators", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.age;
    const validators = field.metadata.validate;
    expect(validators).toBeDefined();
    expect(Array.isArray(validators)).toBe(true);
    expect(validators.length).toBeGreaterThanOrEqual(2);
  });

  test("email field does not have validators", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.email;
    const validators = field.metadata.validate;
    expect(validators).toBeUndefined();
  });
});
