import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("030-fix-broken-model", () => {
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
    expect(fieldNames).toContain("department");
    expect(fieldNames).toContain("salary");
    expect(fieldNames).toContain("hireDate");
    expect(fieldNames).toContain("isActive");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("name is a required string field", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.name;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("department is a required string field", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.department;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("salary is a required integer field", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.salary;
    expect(field.type).toBe("integer");
    expect(field.metadata.required).toBe(true);
  });

  test("hireDate is a required datetime field", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.hireDate;
    expect(field.type).toBe("datetime");
    expect(field.metadata.required).toBe(true);
  });

  test("isActive is an optional boolean field", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.isActive;
    expect(field.type).toBe("boolean");
    expect(field.metadata.required).toBe(false);
  });

  test("timestamps are present with correct types", async () => {
    const { employee } = await import(employeePath);
    expect(employee.fields.createdAt.type).toBe("datetime");
    expect(employee.fields.updatedAt.type).toBe("datetime");
  });
});
