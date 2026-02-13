import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("014-hooks-serial-model", () => {
  const invoicePath = path.join(workDir, "tailordb/invoice.ts");

  test("tailordb/invoice.ts exists", () => {
    expect(fs.existsSync(invoicePath)).toBe(true);
  });

  test("invoice is a named export", async () => {
    const mod = await import(invoicePath);
    expect(mod.invoice).toBeDefined();
  });

  test("invoice model has correct name", async () => {
    const { invoice } = await import(invoicePath);
    expect(invoice.name).toBe("Invoice");
  });

  test("invoice model has all required fields", async () => {
    const { invoice } = await import(invoicePath);
    const fieldNames = Object.keys(invoice.fields);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("invoiceNumber");
    expect(fieldNames).toContain("sequenceId");
    expect(fieldNames).toContain("customerEmail");
    expect(fieldNames).toContain("amount");
    expect(fieldNames).toContain("status");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("invoiceNumber is a string field with serial config", async () => {
    const { invoice } = await import(invoicePath);
    const field = invoice.fields.invoiceNumber;
    expect(field.type).toBe("string");
    expect(field.metadata.serial).toBeDefined();
    expect(field.metadata.serial.start).toBe(1);
    expect(field.metadata.serial.format).toBe("INV-{:05d}");
  });

  test("sequenceId is an integer field with serial config", async () => {
    const { invoice } = await import(invoicePath);
    const field = invoice.fields.sequenceId;
    expect(field.type).toBe("integer");
    expect(field.metadata.serial).toBeDefined();
    expect(field.metadata.serial.start).toBe(1000);
    expect(field.metadata.serial.maxValue).toBe(99999);
  });

  test("customerEmail is a required string", async () => {
    const { invoice } = await import(invoicePath);
    const field = invoice.fields.customerEmail;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("amount is a required float", async () => {
    const { invoice } = await import(invoicePath);
    const field = invoice.fields.amount;
    expect(field.type).toBe("float");
    expect(field.metadata.required).toBe(true);
  });

  test("status is an enum with correct values", async () => {
    const { invoice } = await import(invoicePath);
    const field = invoice.fields.status;
    expect(field.type).toBe("enum");
    expect(field.metadata.required).toBe(true);
    const values = field.metadata.allowedValues.map((v: { value: string }) => v.value);
    expect(values).toEqual(["draft", "sent", "paid", "overdue"]);
  });

  test("customerEmail has hooks defined", async () => {
    const { invoice } = await import(invoicePath);
    const hooks = invoice.fields.customerEmail.metadata.hooks;
    expect(hooks).toBeDefined();
    expect(hooks.create).toBeDefined();
    expect(hooks.update).toBeDefined();
  });

  test("customerEmail create hook lowercases input", async () => {
    const { invoice } = await import(invoicePath);
    const hooks = invoice.fields.customerEmail.metadata.hooks;
    const result = hooks.create({ value: "FOO@BAR.COM", data: {}, user: {} });
    expect(result).toBe("foo@bar.com");
  });

  test("customerEmail update hook lowercases input", async () => {
    const { invoice } = await import(invoicePath);
    const hooks = invoice.fields.customerEmail.metadata.hooks;
    const result = hooks.update({ value: "FOO@BAR.COM", data: {}, user: {} });
    expect(result).toBe("foo@bar.com");
  });

  test("customerEmail create hook handles null", async () => {
    const { invoice } = await import(invoicePath);
    const hooks = invoice.fields.customerEmail.metadata.hooks;
    const result = hooks.create({ value: null, data: {}, user: {} });
    expect(result).toBe("");
  });

  test("timestamps are present with correct types", async () => {
    const { invoice } = await import(invoicePath);
    expect(invoice.fields.createdAt.type).toBe("datetime");
    expect(invoice.fields.updatedAt.type).toBe("datetime");
  });
});
