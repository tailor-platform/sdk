import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirReady = fs.existsSync(path.join(workDir, "node_modules"));

describe.skipIf(!workDirReady)("001-comprehensive-model: Employee", () => {
  const employeePath = path.join(workDir, "tailordb/employee.ts");

  test("employee is a named export with correct model name", async () => {
    const { employee } = await import(employeePath);
    expect(employee).toBeDefined();
    expect(employee.name).toBe("Employee");
  });

  test("employee has all required fields", async () => {
    const { employee } = await import(employeePath);
    const fieldNames = Object.keys(employee.fields);
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("age");
    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("department");
    expect(fieldNames).toContain("address");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("name is a required string field", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.name;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("name validation rejects short values", async () => {
    const { employee } = await import(employeePath);
    const validators = employee.fields.name.metadata.validate;
    expect(validators).toBeDefined();
    expect(validators.length).toBeGreaterThanOrEqual(1);
    const [fn] = validators[0];
    expect(fn({ value: "A" })).toBe(false);
    expect(fn({ value: "AB" })).toBe(true);
  });

  test("age is a required integer with min/max validators", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.age;
    expect(field.type).toBe("integer");
    expect(field.metadata.required).toBe(true);
    const validators = field.metadata.validate;
    expect(validators.length).toBeGreaterThanOrEqual(2);
  });

  test("age validation enforces minimum of 18", async () => {
    const { employee } = await import(employeePath);
    const [minFn] = employee.fields.age.metadata.validate[0];
    expect(minFn({ value: 17 })).toBe(false);
    expect(minFn({ value: 18 })).toBe(true);
  });

  test("age validation enforces maximum of 120", async () => {
    const { employee } = await import(employeePath);
    const [maxFn] = employee.fields.age.metadata.validate[1];
    expect(maxFn({ value: 120 })).toBe(true);
    expect(maxFn({ value: 121 })).toBe(false);
  });

  test("department is an enum with correct values", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.department;
    expect(field.type).toBe("enum");
    const values = field.metadata.allowedValues.map((v: { value: string }) => v.value);
    expect(values).toEqual(["engineering", "sales", "marketing", "hr"]);
  });

  test("address is a required nested object (not array)", async () => {
    const { employee } = await import(employeePath);
    const field = employee.fields.address;
    expect(field.type).toBe("nested");
    expect(field.metadata.required).toBe(true);
    expect(field.metadata.array).toBeUndefined();
  });

  test("address has correct nested fields with expected types and optionality", async () => {
    const { employee } = await import(employeePath);
    const addr = employee.fields.address.fields;

    expect(addr.street.type).toBe("string");
    expect(addr.street.metadata.required).toBe(true);

    expect(addr.city.type).toBe("string");
    expect(addr.city.metadata.required).toBe(true);

    expect(addr.state.type).toBe("string");
    expect(addr.state.metadata.required).toBe(false);

    expect(addr.zipCode.type).toBe("string");
    expect(addr.zipCode.metadata.required).toBe(true);

    expect(addr.country.type).toBe("string");
    expect(addr.country.metadata.required).toBe(true);
  });

  test("timestamps are present with correct types", async () => {
    const { employee } = await import(employeePath);
    expect(employee.fields.createdAt.type).toBe("datetime");
    expect(employee.fields.updatedAt.type).toBe("datetime");
  });
});

describe.skipIf(!workDirReady)("001-comprehensive-model: Event", () => {
  const eventPath = path.join(workDir, "tailordb/event.ts");

  test("event is a named export with correct model name", async () => {
    const { event } = await import(eventPath);
    expect(event).toBeDefined();
    expect(event.name).toBe("Event");
  });

  test("event has all required fields", async () => {
    const { event } = await import(eventPath);
    const fieldNames = Object.keys(event.fields);
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

  test("event fields have correct types and optionality", async () => {
    const { event } = await import(eventPath);
    expect(event.fields.name.type).toBe("string");
    expect(event.fields.eventDate.type).toBe("date");
    expect(event.fields.startTime.type).toBe("time");
    expect(event.fields.endTime.type).toBe("time");
    expect(event.fields.endTime.metadata.required).toBe(false);
    expect(event.fields.capacity.type).toBe("integer");
    expect(event.fields.capacity.metadata.required).toBe(false);
    expect(event.fields.price.type).toBe("float");
    expect(event.fields.price.metadata.required).toBe(true);
    expect(event.fields.scheduledAt.type).toBe("datetime");
    expect(event.fields.scheduledAt.metadata.required).toBe(true);
  });

  test("timestamps are present with correct types", async () => {
    const { event } = await import(eventPath);
    expect(event.fields.createdAt.type).toBe("datetime");
    expect(event.fields.updatedAt.type).toBe("datetime");
  });
});

describe.skipIf(!workDirReady)("001-comprehensive-model: Profile", () => {
  const profilePath = path.join(workDir, "tailordb/profile.ts");
  const userPath = path.join(workDir, "tailordb/user.ts");

  test("profile is a named export with correct model name", async () => {
    const { profile } = await import(profilePath);
    expect(profile).toBeDefined();
    expect(profile.name).toBe("Profile");
  });

  test("userId is a uuid field with relation config", async () => {
    const { profile } = await import(profilePath);
    expect(profile.fields.userId.type).toBe("uuid");
    expect(profile.fields.userId.rawRelation).toBeDefined();
  });

  test("relation type is 1-1", async () => {
    const { profile } = await import(profilePath);
    const relType = profile.fields.userId.rawRelation.type;
    expect(relType === "1-1" || relType === "oneToOne").toBe(true);
  });

  test("relation toward.as is 'owner' and backward is 'profile'", async () => {
    const { profile } = await import(profilePath);
    const rel = profile.fields.userId.rawRelation;
    expect(rel.toward.as).toBe("owner");
    expect(rel.backward).toBe("profile");
  });

  test("bio and avatarUrl are optional string fields", async () => {
    const { profile } = await import(profilePath);
    expect(profile.fields.bio.type).toBe("string");
    expect(profile.fields.bio.metadata.required).toBe(false);
    expect(profile.fields.avatarUrl.type).toBe("string");
    expect(profile.fields.avatarUrl.metadata.required).toBe(false);
  });

  test("user model can be imported without errors", async () => {
    const mod = await import(userPath);
    expect(mod.user).toBeDefined();
    expect(mod.user.name).toBe("User");
  });

  test("timestamps are present with correct types", async () => {
    const { profile } = await import(profilePath);
    expect(profile.fields.createdAt.type).toBe("datetime");
    expect(profile.fields.updatedAt.type).toBe("datetime");
  });
});
