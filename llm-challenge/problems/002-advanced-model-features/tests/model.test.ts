import { describe, expect, test } from "vitest";
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
    expectFieldNames(book, ["title", "isbn", "price", "authorID", "createdAt", "updatedAt"]);
  });

  test("isbn is a required unique string", async () => {
    const { book } = await importPath(bookPath);
    expectFieldType(book.fields.isbn, "string", { required: true, unique: true });
  });

  test("price is an optional integer", async () => {
    const { book } = await importPath(bookPath);
    expectFieldType(book.fields.price, "integer", { required: false });
  });

  test("authorID is a uuid with n-1 relation to Author", async () => {
    const { book } = await importPath(bookPath);
    expectFieldType(book.fields.authorID, "uuid");
    expect(book.fields.authorID.rawRelation).toBeDefined();
    expect(book.fields.authorID.rawRelation.type).toBe("n-1");
    expect(book.fields.authorID.rawRelation.toward.type).toBe("Author");
  });

  test("author model can be imported without errors", async () => {
    const mod = await importPath(authorPath);
    expect(mod.author).toBeDefined();
    expect(mod.author.name).toBe("Author");
  });

  test("timestamps are present", async () => {
    const { book } = await importPath(bookPath);
    expectTimestamps(book);
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
    expectFieldNames(invoice, [
      "invoiceNumber",
      "sequenceId",
      "customerEmail",
      "amount",
      "status",
      "createdAt",
      "updatedAt",
    ]);
  });

  test("invoiceNumber has serial config with correct format", async () => {
    const { invoice } = await importPath(invoicePath);
    const field = invoice.fields.invoiceNumber;
    expectFieldType(field, "string");
    expect(field.metadata.serial).toBeDefined();
    expect(field.metadata.serial.start).toBe(1);
    expect(field.metadata.serial.format).toBe("INV-{:05d}");
  });

  test("sequenceId has serial config with start and maxValue", async () => {
    const { invoice } = await importPath(invoicePath);
    const field = invoice.fields.sequenceId;
    expectFieldType(field, "integer");
    expect(field.metadata.serial).toBeDefined();
    expect(field.metadata.serial.start).toBe(1000);
    expect(field.metadata.serial.maxValue).toBe(99999);
  });

  test("status is an enum with correct values", async () => {
    const { invoice } = await importPath(invoicePath);
    expectEnumValues(invoice.fields.status, ["draft", "sent", "paid", "overdue"]);
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
    expectTimestamps(invoice);
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
    expectFieldNames(product, [
      "name",
      "sku",
      "price",
      "stock",
      "category",
      "isActive",
      "createdAt",
      "updatedAt",
    ]);
  });

  test("name field has index enabled", async () => {
    const { product } = await importPath(productPath);
    expect(product.fields.name.metadata.index).toBe(true);
  });

  test("sku is a required unique string", async () => {
    const { product } = await importPath(productPath);
    expectFieldType(product.fields.sku, "string", { unique: true });
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

  test("gqlPermission has a policy with actions ['read', 'create']", async () => {
    const { product } = await importPath(productPath);
    const gql = product.metadata.permissions.gql;
    const hasReadCreate = gql.some(
      (p: { actions: string | string[] }) =>
        Array.isArray(p.actions) &&
        p.actions.length === 2 &&
        p.actions.includes("read") &&
        p.actions.includes("create"),
    );
    expect(hasReadCreate).toBe(true);
  });

  test("gqlPermission has a policy with actions 'all'", async () => {
    const { product } = await importPath(productPath);
    const gql = product.metadata.permissions.gql;
    const hasAll = gql.some((p: { actions: string | string[] }) => p.actions === "all");
    expect(hasAll).toBe(true);
  });

  test("timestamps are present", async () => {
    const { product } = await importPath(productPath);
    expectTimestamps(product);
  });
});
