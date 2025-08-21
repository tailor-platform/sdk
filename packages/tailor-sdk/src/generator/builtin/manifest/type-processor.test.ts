import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { db } from "@/services/tailordb/schema";

describe("Manifest TypeProcessor", () => {
  it("should process indexes correctly", async () => {
    const typeWithIndexes = db
      .type("User", {
        email: db.string().unique(),
        firstName: db.string().index(),
        lastName: db.string(),
        age: db.int(),
        status: db.string(),
      })
      .indexes(
        { fields: ["firstName", "lastName"], unique: false },
        { fields: ["status", "age"], unique: true },
      );

    const manifest =
      TypeProcessor.generateTailorDBTypeManifest(typeWithIndexes);

    // Check indexes are generated correctly
    expect(manifest.Indexes).toBeDefined();
    expect(Object.keys(manifest.Indexes)).toHaveLength(2);

    // Check first index
    expect(manifest.Indexes["idx_firstName_lastName"]).toBeDefined();
    expect(manifest.Indexes["idx_firstName_lastName"].FieldNames).toEqual([
      "firstName",
      "lastName",
    ]);
    expect(manifest.Indexes["idx_firstName_lastName"].Unique).toBe(false);

    // Check second index
    expect(manifest.Indexes["idx_status_age"]).toBeDefined();
    expect(manifest.Indexes["idx_status_age"].FieldNames).toEqual([
      "status",
      "age",
    ]);
    expect(manifest.Indexes["idx_status_age"].Unique).toBe(true);
  });

  it("should use custom index names when provided", async () => {
    const typeWithNamedIndexes = db
      .type("Product", {
        sku: db.string().unique(),
        category: db.string(),
        brand: db.string(),
        price: db.int(),
      })
      .indexes(
        {
          fields: ["category", "brand"],
          unique: false,
          name: "category_brand_index",
        },
        { fields: ["brand", "price"], unique: false, name: "brand_price_idx" },
      );

    const manifest =
      TypeProcessor.generateTailorDBTypeManifest(typeWithNamedIndexes);

    // Check custom index names are used
    expect(manifest.Indexes).toBeDefined();
    expect(Object.keys(manifest.Indexes)).toHaveLength(2);

    // Check first custom named index
    expect(manifest.Indexes["category_brand_index"]).toBeDefined();
    expect(manifest.Indexes["category_brand_index"].FieldNames).toEqual([
      "category",
      "brand",
    ]);
    expect(manifest.Indexes["category_brand_index"].Unique).toBe(false);

    // Check second custom named index
    expect(manifest.Indexes["brand_price_idx"]).toBeDefined();
    expect(manifest.Indexes["brand_price_idx"].FieldNames).toEqual([
      "brand",
      "price",
    ]);
    expect(manifest.Indexes["brand_price_idx"].Unique).toBe(false);
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
