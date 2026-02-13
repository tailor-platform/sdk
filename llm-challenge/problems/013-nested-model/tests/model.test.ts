import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("013-nested-model", () => {
  const companyPath = path.join(workDir, "tailordb/company.ts");

  test("tailordb/company.ts exists", () => {
    expect(fs.existsSync(companyPath)).toBe(true);
  });

  test("company is a named export", async () => {
    const mod = await import(companyPath);
    expect(mod.company).toBeDefined();
  });

  test("company model has correct name", async () => {
    const { company } = await import(companyPath);
    expect(company.name).toBe("Company");
  });

  test("company model has description", async () => {
    const { company } = await import(companyPath);
    expect(company._description).toBe("Company information with nested address and contacts");
  });

  test("company model has all required fields", async () => {
    const { company } = await import(companyPath);
    const fieldNames = Object.keys(company.fields);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("address");
    expect(fieldNames).toContain("contacts");
    expect(fieldNames).toContain("industry");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("name is a required string with description", async () => {
    const { company } = await import(companyPath);
    const field = company.fields.name;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
    expect(field.metadata.description).toBe("Company legal name");
  });

  test("address is a required nested object (not array)", async () => {
    const { company } = await import(companyPath);
    const field = company.fields.address;
    expect(field.type).toBe("nested");
    expect(field.metadata.required).toBe(true);
    expect(field.metadata.array).toBeUndefined();
  });

  test("address has correct nested fields", async () => {
    const { company } = await import(companyPath);
    const addressFields = company.fields.address.fields;

    expect(addressFields.street.type).toBe("string");
    expect(addressFields.street.metadata.required).toBe(true);

    expect(addressFields.city.type).toBe("string");
    expect(addressFields.city.metadata.required).toBe(true);

    expect(addressFields.state.type).toBe("string");
    expect(addressFields.state.metadata.required).toBe(false);

    expect(addressFields.zipCode.type).toBe("string");
    expect(addressFields.zipCode.metadata.required).toBe(true);

    expect(addressFields.country.type).toBe("string");
    expect(addressFields.country.metadata.required).toBe(true);
  });

  test("contacts is a required nested array", async () => {
    const { company } = await import(companyPath);
    const field = company.fields.contacts;
    expect(field.type).toBe("nested");
    expect(field.metadata.required).toBe(true);
    expect(field.metadata.array).toBe(true);
  });

  test("contacts has correct nested fields", async () => {
    const { company } = await import(companyPath);
    const contactFields = company.fields.contacts.fields;

    expect(contactFields.name.type).toBe("string");
    expect(contactFields.name.metadata.required).toBe(true);

    expect(contactFields.email.type).toBe("string");
    expect(contactFields.email.metadata.required).toBe(true);

    expect(contactFields.role.type).toBe("string");
    expect(contactFields.role.metadata.required).toBe(false);
  });

  test("industry is an optional string", async () => {
    const { company } = await import(companyPath);
    const field = company.fields.industry;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(false);
  });

  test("timestamps are present with correct types", async () => {
    const { company } = await import(companyPath);
    expect(company.fields.createdAt.type).toBe("datetime");
    expect(company.fields.updatedAt.type).toBe("datetime");
  });
});
