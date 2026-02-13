import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("004-datetime-model", () => {
  const eventPath = path.join(workDir, "tailordb/event.ts");

  test("tailordb/event.ts exists", () => {
    expect(fs.existsSync(eventPath)).toBe(true);
  });

  test("event is a named export", async () => {
    const mod = await import(eventPath);
    expect(mod.event).toBeDefined();
  });

  test("event model has correct name", async () => {
    const { event } = await import(eventPath);
    expect(event.name).toBe("Event");
  });

  test("event model has all required fields", async () => {
    const { event } = await import(eventPath);
    const fieldNames = Object.keys(event.fields);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("eventDate");
    expect(fieldNames).toContain("startTime");
    expect(fieldNames).toContain("endTime");
    expect(fieldNames).toContain("capacity");
    expect(fieldNames).toContain("price");
    expect(fieldNames).toContain("scheduledAt");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("name is a required string field", async () => {
    const { event } = await import(eventPath);
    const field = event.fields.name;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("eventDate is a required date field", async () => {
    const { event } = await import(eventPath);
    const field = event.fields.eventDate;
    expect(field.type).toBe("date");
    expect(field.metadata.required).toBe(true);
  });

  test("startTime is a required time field", async () => {
    const { event } = await import(eventPath);
    const field = event.fields.startTime;
    expect(field.type).toBe("time");
    expect(field.metadata.required).toBe(true);
  });

  test("endTime is an optional time field", async () => {
    const { event } = await import(eventPath);
    const field = event.fields.endTime;
    expect(field.type).toBe("time");
    expect(field.metadata.required).toBe(false);
  });

  test("capacity is an optional integer field", async () => {
    const { event } = await import(eventPath);
    const field = event.fields.capacity;
    expect(field.type).toBe("integer");
    expect(field.metadata.required).toBe(false);
  });

  test("price is a required float field", async () => {
    const { event } = await import(eventPath);
    const field = event.fields.price;
    expect(field.type).toBe("float");
    expect(field.metadata.required).toBe(true);
  });

  test("scheduledAt is a required datetime field", async () => {
    const { event } = await import(eventPath);
    const field = event.fields.scheduledAt;
    expect(field.type).toBe("datetime");
    expect(field.metadata.required).toBe(true);
  });

  test("timestamps are present with correct types", async () => {
    const { event } = await import(eventPath);
    expect(event.fields.createdAt.type).toBe("datetime");
    expect(event.fields.updatedAt.type).toBe("datetime");
  });
});
