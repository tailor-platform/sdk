import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { db } from "@/services/tailordb/schema";

describe("Manifest TypeProcessor", () => {
  it("should process deeply nested objects correctly", async () => {
    const nestedObjectType = db.type("UserProfile", {
      profile: db.object({
        personal: db.object({
          name: db.string(),
          age: db.int().optional(),
        }),
        contact: db
          .object({
            email: db.string(),
            phone: db.string().optional(),
          })
          .optional(),
      }),
    });

    const result = await TypeProcessor.processType(nestedObjectType);

    expect(result.name).toBe("UserProfile");
    expect(result.fields).toHaveLength(2);

    const idField = result.fields.find((f) => f.name === "id");
    expect(idField).toBeDefined();
    expect(idField?.required).toBe(true);

    const profileField = result.fields.find((f) => f.name === "profile");
    expect(profileField).toBeDefined();
    expect(profileField?.name).toBe("profile");
    expect(profileField?.required).toBe(true);

    // ネストした構造が正しく処理されているか確認
    expect((profileField as any).Fields).toBeDefined();
    expect((profileField as any).Fields.personal).toBeDefined();
    expect((profileField as any).Fields.contact).toBeDefined();

    const personalField = (profileField as any).Fields.personal;
    expect(personalField.Fields).toBeDefined();
    expect(personalField.Fields.name).toBeDefined();
    expect(personalField.Fields.name.Required).toBe(true);
    expect(personalField.Fields.age).toBeDefined();
    expect(personalField.Fields.age.Required).toBe(false);

    const contactField = (profileField as any).Fields.contact;
    expect(contactField.Fields).toBeDefined();
    expect(contactField.Fields.email).toBeDefined();
    expect(contactField.Fields.email.Required).toBe(true);
    expect(contactField.Fields.phone).toBeDefined();
    expect(contactField.Fields.phone.Required).toBe(false);
  });

  it("should handle single level nested objects", async () => {
    const simpleNestedType = db.type("SimpleUser", {
      profile: db.object({
        name: db.string(),
        email: db.string().optional(),
      }),
    });

    const result = await TypeProcessor.processType(simpleNestedType);

    expect(result.name).toBe("SimpleUser");
    expect(result.fields).toHaveLength(2);

    const idField = result.fields.find((f) => f.name === "id");
    expect(idField).toBeDefined();
    expect(idField?.required).toBe(true);

    const profileField = result.fields.find((f) => f.name === "profile");
    expect(profileField).toBeDefined();
    expect(profileField?.name).toBe("profile");
    expect(profileField?.required).toBe(true);
    expect((profileField as any).Fields).toBeDefined();
    expect((profileField as any).Fields.name).toBeDefined();
    expect((profileField as any).Fields.email).toBeDefined();
  });

  it("should handle plural forms correctly", async () => {
    const typeWithPluralForm = db.type(["Person", "People"], {
      name: db.string(),
      age: db.int(),
    });

    const result = await TypeProcessor.processType(typeWithPluralForm);

    expect(result.name).toBe("Person");
    expect(result.typeManifest.Settings.PluralForm).toBe("people");
  });

  it("should handle types without plural forms", async () => {
    const typeWithoutPluralForm = db.type("User", {
      name: db.string(),
      email: db.string(),
    });

    const result = await TypeProcessor.processType(typeWithoutPluralForm);

    expect(result.name).toBe("User");
    expect(result.typeManifest.Settings.PluralForm).toBe("");
  });

  it("should handle empty plural form", async () => {
    const typeWithEmptyPluralForm = db.type(["Data", ""], {
      value: db.string(),
    });

    const result = await TypeProcessor.processType(typeWithEmptyPluralForm);

    expect(result.name).toBe("Data");
    expect(result.typeManifest.Settings.PluralForm).toBe("");
  });

  it("should handle non-standard plural forms", async () => {
    const typeWithCustomPluralForm = db.type(["Mouse", "Mice"], {
      name: db.string(),
    });

    const result = await TypeProcessor.processType(typeWithCustomPluralForm);

    expect(result.name).toBe("Mouse");
    expect(result.typeManifest.Settings.PluralForm).toBe("mice");
  });

  it("should handle Japanese plural forms", async () => {
    const typeWithJapanesePluralForm = db.type(["User", "ユーザー"], {
      name: db.string(),
    });

    const result = await TypeProcessor.processType(typeWithJapanesePluralForm);

    expect(result.name).toBe("User");
    expect(result.typeManifest.Settings.PluralForm).toBe("ユーザー");
  });

  it("should include plural form in manifest with all other settings", async () => {
    const complexType = db.type(["Category", "Categories"], {
      name: db.string(),
      description: db.string().optional(),
      parent: db.uuid().optional(),
    });

    const result = await TypeProcessor.processType(complexType);

    expect(result.typeManifest).toMatchObject({
      Name: "Category",
      Settings: {
        Aggregation: false,
        BulkUpsert: false,
        Draft: false,
        DefaultQueryLimitSize: 100,
        MaxBulkUpsertSize: 1000,
        PluralForm: "categories",
        PublishRecordEvents: false,
      },
    });
  });

  it("should handle special characters in plural forms", async () => {
    const typeWithSpecialChars = db.type(["Company", "Companies"], {
      name: db.string(),
      address: db.string(),
    });

    const result = await TypeProcessor.processType(typeWithSpecialChars);

    expect(result.name).toBe("Company");
    expect(result.typeManifest.Settings.PluralForm).toBe("companies");
  });

  it("should handle mixed case plural forms", async () => {
    const typeWithMixedCase = db.type(["Dataset", "DataSets"], {
      name: db.string(),
      values: db.string().array(),
    });

    const result = await TypeProcessor.processType(typeWithMixedCase);

    expect(result.name).toBe("Dataset");
    expect(result.typeManifest.Settings.PluralForm).toBe("dataSets");
  });

  it("should handle plural forms with validation rules", async () => {
    const typeWithValidation = db
      .type(["Product", "Products"], {
        name: db.string(),
        price: db.float(),
      })
      .validate({
        name: [({ value }) => value.length > 0, "Name is required"],
        price: [({ value }) => value > 0, "Price must be positive"],
      });

    const result = await TypeProcessor.processType(typeWithValidation);

    expect(result.name).toBe("Product");
    expect(result.typeManifest.Settings.PluralForm).toBe("products");
    expect(result.fields).toHaveLength(3); // id, name, price
  });

  it("should handle plural forms in type with relations", async () => {
    const categoryType = db.type(["Category", "Categories"], {
      name: db.string(),
    });

    const productType = db.type(["Product", "Products"], {
      name: db.string(),
      categoryId: db.uuid().relation({
        type: "oneToOne",
        toward: { type: categoryType },
      }),
    });

    const categoryResult = await TypeProcessor.processType(categoryType);
    const productResult = await TypeProcessor.processType(productType);

    expect(categoryResult.typeManifest.Settings.PluralForm).toBe("categories");
    expect(productResult.typeManifest.Settings.PluralForm).toBe("products");
  });

  it("should handle non-English plural forms consistently", async () => {
    const typeWithNonEnglish = db.type(["Book", "本"], {
      title: db.string(),
      author: db.string(),
    });

    const result = await TypeProcessor.processType(typeWithNonEnglish);

    expect(result.name).toBe("Book");
    expect(result.typeManifest.Settings.PluralForm).toBe("本");
  });
});
