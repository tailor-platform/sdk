import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { importPath } from "../../../shared/helpers.js";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirReady = fs.existsSync(path.join(workDir, "node_modules"));

describe.skipIf(!workDirReady)("002-advanced-model-features: Book", () => {
  const bookPath = path.join(workDir, "tailordb/book.ts");
  const authorPath = path.join(workDir, "tailordb/author.ts");

  test("book is a named export with correct model name", async () => {
    const { book } = await importPath(bookPath);
    expect(book).toBeDefined();
    expect(book.name).toBe("Book");
  });

  test("book has all expected fields", async () => {
    const { book } = await importPath(bookPath);
    const fieldNames = Object.keys(book.fields);
    expect(fieldNames).toContain("title");
    expect(fieldNames).toContain("isbn");
    expect(fieldNames).toContain("price");
    expect(fieldNames).toContain("authorID");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("isbn is a required unique string", async () => {
    const { book } = await importPath(bookPath);
    expect(book.fields.isbn.type).toBe("string");
    expect(book.fields.isbn.metadata.required).toBe(true);
    expect(book.fields.isbn.metadata.unique).toBe(true);
  });

  test("price is an optional integer", async () => {
    const { book } = await importPath(bookPath);
    expect(book.fields.price.type).toBe("integer");
    expect(book.fields.price.metadata.required).toBe(false);
  });

  test("authorID is a uuid with n-1 relation to Author", async () => {
    const { book } = await importPath(bookPath);
    const field = book.fields.authorID;
    expect(field.type).toBe("uuid");
    expect(field.rawRelation).toBeDefined();
    expect(field.rawRelation.type).toBe("n-1");
    expect(field.rawRelation.toward.type).toBe("Author");
  });

  test("author model can be imported without errors", async () => {
    const mod = await importPath(authorPath);
    expect(mod.author).toBeDefined();
    expect(mod.author.name).toBe("Author");
  });

  test("timestamps are present", async () => {
    const { book } = await importPath(bookPath);
    expect(book.fields.createdAt.type).toBe("datetime");
    expect(book.fields.updatedAt.type).toBe("datetime");
  });
});

describe.skipIf(!workDirReady)("002-advanced-model-features: Invoice", () => {
  const invoicePath = path.join(workDir, "tailordb/invoice.ts");

  test("invoice is a named export with correct model name", async () => {
    const { invoice } = await importPath(invoicePath);
    expect(invoice).toBeDefined();
    expect(invoice.name).toBe("Invoice");
  });

  test("invoice has all expected fields", async () => {
    const { invoice } = await importPath(invoicePath);
    const fieldNames = Object.keys(invoice.fields);
    expect(fieldNames).toContain("invoiceNumber");
    expect(fieldNames).toContain("sequenceId");
    expect(fieldNames).toContain("customerEmail");
    expect(fieldNames).toContain("amount");
    expect(fieldNames).toContain("status");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("invoiceNumber has serial config with correct format", async () => {
    const { invoice } = await importPath(invoicePath);
    const field = invoice.fields.invoiceNumber;
    expect(field.type).toBe("string");
    expect(field.metadata.serial).toBeDefined();
    expect(field.metadata.serial.start).toBe(1);
    expect(field.metadata.serial.format).toBe("INV-{:05d}");
  });

  test("sequenceId has serial config with start and maxValue", async () => {
    const { invoice } = await importPath(invoicePath);
    const field = invoice.fields.sequenceId;
    expect(field.type).toBe("integer");
    expect(field.metadata.serial).toBeDefined();
    expect(field.metadata.serial.start).toBe(1000);
    expect(field.metadata.serial.maxValue).toBe(99999);
  });

  test("status is an enum with correct values", async () => {
    const { invoice } = await importPath(invoicePath);
    const field = invoice.fields.status;
    expect(field.type).toBe("enum");
    const values = field.metadata.allowedValues.map((v: { value: string }) => v.value);
    expect(values).toEqual(["draft", "sent", "paid", "overdue"]);
  });

  test("customerEmail has create and update hooks defined", async () => {
    const { invoice } = await importPath(invoicePath);
    const hooks = invoice.fields.customerEmail.metadata.hooks;
    expect(hooks).toBeDefined();
    expect(hooks.create).toBeDefined();
    expect(hooks.update).toBeDefined();
  });

  test("customerEmail create hook lowercases input", async () => {
    const { invoice } = await importPath(invoicePath);
    const hooks = invoice.fields.customerEmail.metadata.hooks;
    const result = hooks.create({ value: "FOO@BAR.COM", data: {}, user: {} });
    expect(result).toBe("foo@bar.com");
  });

  test("customerEmail update hook lowercases input", async () => {
    const { invoice } = await importPath(invoicePath);
    const hooks = invoice.fields.customerEmail.metadata.hooks;
    const result = hooks.update({ value: "MIXED@Case.Email", data: {}, user: {} });
    expect(result).toBe("mixed@case.email");
  });

  test("customerEmail create hook handles null by returning empty string", async () => {
    const { invoice } = await importPath(invoicePath);
    const hooks = invoice.fields.customerEmail.metadata.hooks;
    const result = hooks.create({ value: null, data: {}, user: {} });
    expect(result).toBe("");
  });

  test("timestamps are present", async () => {
    const { invoice } = await importPath(invoicePath);
    expect(invoice.fields.createdAt.type).toBe("datetime");
    expect(invoice.fields.updatedAt.type).toBe("datetime");
  });
});

describe.skipIf(!workDirReady)("002-advanced-model-features: Product", () => {
  const productPath = path.join(workDir, "tailordb/product.ts");

  test("product is a named export with correct model name", async () => {
    const { product } = await importPath(productPath);
    expect(product).toBeDefined();
    expect(product.name).toBe("Product");
  });

  test("product has plural form Products", async () => {
    const { product } = await importPath(productPath);
    expect(product.metadata.settings?.pluralForm).toBe("Products");
  });

  test("product has all expected fields", async () => {
    const { product } = await importPath(productPath);
    const fieldNames = Object.keys(product.fields);
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("sku");
    expect(fieldNames).toContain("price");
    expect(fieldNames).toContain("stock");
    expect(fieldNames).toContain("category");
    expect(fieldNames).toContain("isActive");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("name field has index enabled", async () => {
    const { product } = await importPath(productPath);
    expect(product.fields.name.metadata.index).toBe(true);
  });

  test("sku is a required unique string", async () => {
    const { product } = await importPath(productPath);
    expect(product.fields.sku.type).toBe("string");
    expect(product.fields.sku.metadata.unique).toBe(true);
  });

  test("aggregation feature is enabled", async () => {
    const { product } = await importPath(productPath);
    expect(product.metadata.settings?.aggregation).toBe(true);
  });

  test("bulkUpsert feature is enabled", async () => {
    const { product } = await importPath(productPath);
    expect(product.metadata.settings?.bulkUpsert).toBe(true);
  });

  test("composite index idx_category_active exists with correct fields", async () => {
    const { product } = await importPath(productPath);
    const indexes = product.metadata.indexes;
    expect(indexes).toBeDefined();
    expect(indexes.idx_category_active).toBeDefined();
    expect(indexes.idx_category_active.fields).toEqual(["category", "isActive"]);
  });

  test("record-level permission create has 1 rule", async () => {
    const { product } = await importPath(productPath);
    const perm = product.metadata.permissions.record;
    expect(perm.create).toHaveLength(1);
    expect(perm.create[0].permit).toBe(true);
  });

  test("record-level permission read has 2 rules", async () => {
    const { product } = await importPath(productPath);
    const perm = product.metadata.permissions.record;
    expect(perm.read).toHaveLength(2);
  });

  test("record-level permission update has 1 rule using newRecord", async () => {
    const { product } = await importPath(productPath);
    const perm = product.metadata.permissions.record;
    expect(perm.update).toHaveLength(1);
    expect(perm.update[0].conditions[0][0]).toEqual({ newRecord: "ownerId" });
  });

  test("record-level permission delete has 1 rule", async () => {
    const { product } = await importPath(productPath);
    const perm = product.metadata.permissions.record;
    expect(perm.delete).toHaveLength(1);
    expect(perm.delete[0].permit).toBe(true);
  });

  test("gqlPermission has 2 policies", async () => {
    const { product } = await importPath(productPath);
    const gql = product.metadata.permissions.gql;
    expect(gql).toHaveLength(2);
  });

  test("first gqlPermission policy has actions ['read', 'create']", async () => {
    const { product } = await importPath(productPath);
    const gql = product.metadata.permissions.gql;
    expect(gql[0].actions).toEqual(["read", "create"]);
  });

  test("second gqlPermission policy has actions 'all'", async () => {
    const { product } = await importPath(productPath);
    const gql = product.metadata.permissions.gql;
    expect(gql[1].actions).toBe("all");
  });

  test("timestamps are present", async () => {
    const { product } = await importPath(productPath);
    expect(product.fields.createdAt.type).toBe("datetime");
    expect(product.fields.updatedAt.type).toBe("datetime");
  });
});
