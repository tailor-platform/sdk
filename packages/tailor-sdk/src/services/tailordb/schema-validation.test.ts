// Basic test for the TailorDBType validation functionality
import { beforeEach, describe, it, expect } from "vitest";
import { db } from "./schema";

describe("TailorDBType validation functionality", () => {
  const generateUserType = () =>
    db.type("User", {
      name: db.string(),
      email: db.string(),
      age: db.int().optional(),
    });
  let UserType!: ReturnType<typeof generateUserType>;
  beforeEach(() => {
    UserType = generateUserType();
  });

  it("should have a validate method that accepts field validators", () => {
    // Test that validate method exists and can be called
    const result = UserType.validate({
      name: [({ value }) => value.length > 0],
      email: [({ value }) => value.includes("@")],
      age: [({ value }) => value == null || value >= 0],
    });

    // Should return the type instance for chaining
    expect(result).toBe(UserType);
  });

  it("should set validators on individual fields", () => {
    const emailValidator = ({ value }: { value: string }) =>
      value.includes("@");
    const nameValidator = ({ value }: { value: string }) => value.length > 0;

    UserType.validate({
      name: [nameValidator],
      email: [emailValidator],
    });

    // Check that validators were set on the fields

    expect((UserType.fields.name as any)._metadata.validate).toEqual([
      nameValidator,
    ]);

    expect((UserType.fields.email as any)._metadata.validate).toEqual([
      emailValidator,
    ]);
  });

  it("should work with both field-level and type-level validators", () => {
    const UserType = db.type("User", {
      // Field-level validator
      name: db.string().validate(({ value }) => value.length > 0),
      email: db.string(),
    });
    const emailValidator = ({ value }: { value: string }) =>
      value.includes("@");

    UserType.validate({
      email: [emailValidator],
    });

    // Field-level validator should still be there

    expect((UserType.fields.name as any)._metadata.validate).toHaveLength(1);

    expect((UserType.fields.name as any)._metadata.validate[0]).toBeInstanceOf(
      Function,
    );

    // Type-level validator should be set

    expect((UserType.fields.email as any)._metadata.validate).toEqual([
      emailValidator,
    ]);
  });
});
