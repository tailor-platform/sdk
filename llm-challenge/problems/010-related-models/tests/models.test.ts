import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileExists } from "../../../shared/helpers";

const workDir = path.resolve(import.meta.dirname, "../work");
const workDirExists = fs.existsSync(workDir);
const bookPath = path.join(workDir, "tailordb/book.ts");
const authorPath = path.join(workDir, "tailordb/author.ts");

describe.skipIf(!workDirExists)("010: Related Models - Book model", () => {
  it("tailordb/book.ts exists", () => {
    expect(fileExists(bookPath)).toBe(true);
  });

  it("exports a named 'book' value", async () => {
    const mod = await import(bookPath);
    expect(mod.book).toBeDefined();
  });

  it("book model has correct name", async () => {
    const { book } = await import(bookPath);
    expect(book.name).toBe("Book");
  });

  it("book model has all expected fields", async () => {
    const { book } = await import(bookPath);
    const fieldNames = Object.keys(book.fields);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("title");
    expect(fieldNames).toContain("isbn");
    expect(fieldNames).toContain("price");
    expect(fieldNames).toContain("authorID");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  it("title field is a required string", async () => {
    const { book } = await import(bookPath);
    expect(book.fields.title.type).toBe("string");
    expect(book.fields.title.metadata.required).toBe(true);
  });

  it("isbn field is a required unique string", async () => {
    const { book } = await import(bookPath);
    expect(book.fields.isbn.type).toBe("string");
    expect(book.fields.isbn.metadata.required).toBe(true);
    expect(book.fields.isbn.metadata.unique).toBe(true);
  });

  it("price field is an optional integer", async () => {
    const { book } = await import(bookPath);
    expect(book.fields.price.type).toBe("integer");
    expect(book.fields.price.metadata.required).toBe(false);
  });

  it("authorID field is a uuid with n-1 relation to Author", async () => {
    const { book } = await import(bookPath);
    const authorIDField = book.fields.authorID;
    expect(authorIDField.type).toBe("uuid");
    expect(authorIDField.rawRelation).toBeDefined();
    expect(authorIDField.rawRelation.type).toBe("n-1");
    expect(authorIDField.rawRelation.toward.type).toBe("Author");
  });

  it("author model can be imported without errors", async () => {
    const mod = await import(authorPath);
    expect(mod.author).toBeDefined();
    expect(mod.author.name).toBe("Author");
  });
});
