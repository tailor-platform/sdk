import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  createWorkDirContext,
  expectFieldNames,
  expectFieldType,
  expectTimestamps,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("001-comprehensive-model: Employee", () => {
  const employeePath = path.join(workDir, "tailordb/employee.ts");

  test("employee is a named export with correct model name", async () => {
    const { employee } = await importPath(employeePath);
    expect(employee).toBeDefined();
    expect(employee.name).toBe("Employee");
  });

  test("employee has all required fields", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldNames(employee, [
      "name",
      "age",
      "email",
      "department",
      "address",
      "createdAt",
      "updatedAt",
    ]);
  });

  test("name is a required string field", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldType(employee.fields.name, "string", { required: true });
  });

  test("name validation rejects short values", async () => {
    const { employee } = await importPath(employeePath);
    const validators = employee.fields.name.metadata.validate;
    expect(validators).toBeDefined();
    expect(validators.length).toBeGreaterThanOrEqual(1);
    const [fn] = validators[0];
    expect(fn({ value: "A" })).toBe(false);
    expect(fn({ value: "AB" })).toBe(true);
  });

  test("age is a required integer with min/max validators", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldType(employee.fields.age, "integer", { required: true });
    const validators = employee.fields.age.metadata.validate;
    expect(validators.length).toBeGreaterThanOrEqual(2);
  });

  test("age validation enforces minimum of 18", async () => {
    const { employee } = await importPath(employeePath);
    const validators = employee.fields.age.metadata.validate;
    const minValidator = validators.find(
      ([fn]: [(_: { value: number }) => boolean]) =>
        fn({ value: 17 }) === false && fn({ value: 18 }) === true,
    );
    expect(minValidator).toBeDefined();
  });

  test("age validation enforces maximum of 120", async () => {
    const { employee } = await importPath(employeePath);
    const validators = employee.fields.age.metadata.validate;
    const maxValidator = validators.find(
      ([fn]: [(_: { value: number }) => boolean]) =>
        fn({ value: 120 }) === true && fn({ value: 121 }) === false,
    );
    expect(maxValidator).toBeDefined();
  });

  test("department is an enum with correct values", async () => {
    const { employee } = await importPath(employeePath);
    expect(employee.fields.department.type).toBe("enum");
    const values = employee.fields.department.metadata.allowedValues.map(
      (v: { value: string }) => v.value,
    );
    expect(values).toEqual(["engineering", "sales", "marketing", "hr"]);
  });

  test("address is a required nested object (not array)", async () => {
    const { employee } = await importPath(employeePath);
    expectFieldType(employee.fields.address, "nested", { required: true });
    expect(employee.fields.address.metadata.array).toBeUndefined();
  });

  test("address has correct nested fields with expected types and optionality", async () => {
    const { employee } = await importPath(employeePath);
    const addr = employee.fields.address.fields;

    expectFieldType(addr.street, "string", { required: true });
    expectFieldType(addr.city, "string", { required: true });
    expectFieldType(addr.state, "string", { required: false });
    expectFieldType(addr.zipCode, "string", { required: true });
    expectFieldType(addr.country, "string", { required: true });
  });

  test("timestamps are present with correct types", async () => {
    const { employee } = await importPath(employeePath);
    expectTimestamps(employee);
  });
});

describe.skipIf(!workDirReady)("001-comprehensive-model: Event", () => {
  const eventPath = path.join(workDir, "tailordb/event.ts");

  test("event is a named export with correct model name", async () => {
    const { event } = await importPath(eventPath);
    expect(event).toBeDefined();
    expect(event.name).toBe("Event");
  });

  test("event has all required fields", async () => {
    const { event } = await importPath(eventPath);
    expectFieldNames(event, [
      "name",
      "eventDate",
      "startTime",
      "endTime",
      "capacity",
      "price",
      "scheduledAt",
      "createdAt",
      "updatedAt",
    ]);
  });

  test("event fields have correct types and optionality", async () => {
    const { event } = await importPath(eventPath);
    expectFieldType(event.fields.name, "string");
    expectFieldType(event.fields.eventDate, "date");
    expectFieldType(event.fields.startTime, "time");
    expectFieldType(event.fields.endTime, "time", { required: false });
    expectFieldType(event.fields.capacity, "integer", { required: false });
    expectFieldType(event.fields.price, "float", { required: true });
    expectFieldType(event.fields.scheduledAt, "datetime", { required: true });
  });

  test("timestamps are present with correct types", async () => {
    const { event } = await importPath(eventPath);
    expectTimestamps(event);
  });
});

describe.skipIf(!workDirReady)("001-comprehensive-model: Profile", () => {
  const profilePath = path.join(workDir, "tailordb/profile.ts");
  const userPath = path.join(workDir, "tailordb/user.ts");

  test("profile is a named export with correct model name", async () => {
    const { profile } = await importPath(profilePath);
    expect(profile).toBeDefined();
    expect(profile.name).toBe("Profile");
  });

  test("userId is a uuid field with relation config", async () => {
    const { profile } = await importPath(profilePath);
    expectFieldType(profile.fields.userId, "uuid");
    expect(profile.fields.userId.rawRelation).toBeDefined();
  });

  test("relation type is 1-1", async () => {
    const { profile } = await importPath(profilePath);
    const relType = profile.fields.userId.rawRelation.type;
    expect(relType === "1-1" || relType === "oneToOne").toBe(true);
  });

  test("relation toward.as is 'owner' and backward is 'profile'", async () => {
    const { profile } = await importPath(profilePath);
    const rel = profile.fields.userId.rawRelation;
    expect(rel.toward.as).toBe("owner");
    expect(rel.backward).toBe("profile");
  });

  test("bio and avatarUrl are optional string fields", async () => {
    const { profile } = await importPath(profilePath);
    expectFieldType(profile.fields.bio, "string", { required: false });
    expectFieldType(profile.fields.avatarUrl, "string", { required: false });
  });

  test("user model can be imported without errors", async () => {
    const mod = await importPath(userPath);
    expect(mod.user).toBeDefined();
    expect(mod.user.name).toBe("User");
  });

  test("timestamps are present with correct types", async () => {
    const { profile } = await importPath(profilePath);
    expectTimestamps(profile);
  });
});
