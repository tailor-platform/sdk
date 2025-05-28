import {
  generateSDL,
  generateSDLFromMetadata,
  t,
} from "@tailor-platform/tailor-sdk";

import { describe, expect, test } from "@jest/globals";

const productItem = t.dbType(
  "ProductItem",
  { name: t.string().unique() }
);
const productType = t.dbType(
  "Product",
  {
    name: t.string().unique(),
    description: t.string().optional(),
    price: t.int(),
    weight: t.float().optional(),
    variants: t.string().array().optional(),
    itemIDs: t.uuid().ref(productItem, ["items", "product"]).array().optional(),
  },
  { withTimestamps: true },
);

describe("TailorDB: object style", () => {
  test("sdl", () => {
    const sdl = generateSDLFromMetadata(productType.toSDLMetadata());
    // console.log(sdl);

    expect(sdl).toContain(`type Product {`);
    expect(sdl).toContain(`id: ID!`);
    expect(sdl).toContain(`name: String!`);
    expect(sdl).toContain(`description: String`);
    expect(sdl).toContain(`price: Int!`);
    expect(sdl).toContain(`weight: Float`);
    expect(sdl).toContain(`variants: [String]`);
    expect(sdl).toContain(`itemIDs: [ID]`);
    expect(sdl).toContain(`items: [ProductItem]`);
    expect(sdl).toContain(`createdAt: DateTime!`);
    expect(sdl).toContain(`updatedAt: DateTime!`);
  });
  test("metadata", () => {
    const metadata = productType.metadata;
    // console.log(metadata);

    expect(metadata.name).toBe("Product");
    expect(metadata.schema).toBeDefined();
    const schema = metadata.schema;
    expect(schema?.fields).toBeDefined();
    const fields = schema?.fields!;
    expect(fields["name"]).toBeDefined();

    const nameField = fields["name"];
    expect(nameField["type"]).toBe("string");
    expect(nameField["required"]).toBe(true);
    expect(nameField["index"]).toBe(true);
    expect(nameField["unique"]).toBe(true);
    expect(nameField["array"]).toBe(false);
    expect(nameField["vector"]).toBe(false);
    expect(nameField["foreignKey"]).toBe(false);
    expect(nameField["validate"].length).toBe(0);
    expect(nameField["allowedValues"].length).toBe(0);

    const descriptionField = fields["description"];
    expect(descriptionField["type"]).toBe("string");
    expect(descriptionField["required"]).toBe(false);
    expect(descriptionField["index"]).toBe(false);
    expect(descriptionField["unique"]).toBe(false);
    expect(descriptionField["array"]).toBe(false);
    expect(descriptionField["vector"]).toBe(false);
    expect(descriptionField["foreignKey"]).toBe(false);
    expect(descriptionField["validate"].length).toBe(0);
    expect(descriptionField["allowedValues"].length).toBe(0);

    const priceField = fields["price"];
    expect(priceField["type"]).toBe("integer");
    expect(priceField["required"]).toBe(true);
    expect(priceField["index"]).toBe(false);
    expect(priceField["unique"]).toBe(false);
    expect(priceField["array"]).toBe(false);
    expect(priceField["vector"]).toBe(false);
    expect(priceField["foreignKey"]).toBe(false);
    expect(priceField["validate"].length).toBe(0);
    expect(priceField["allowedValues"].length).toBe(0);

    const weightField = fields["weight"];
    expect(weightField["type"]).toBe("float");
    expect(weightField["required"]).toBe(false);
    expect(weightField["index"]).toBe(false);
    expect(weightField["unique"]).toBe(false);
    expect(weightField["array"]).toBe(false);
    expect(weightField["vector"]).toBe(false);
    expect(weightField["foreignKey"]).toBe(false);
    expect(weightField["validate"].length).toBe(0);
    expect(weightField["allowedValues"].length).toBe(0);

    const createdAtField = fields["createdAt"];
    expect(createdAtField["type"]).toBe("datetime");
    expect(createdAtField["hooks"]?.create).toBeDefined();

    const updateAtField = fields["updatedAt"];
    expect(updateAtField["type"]).toBe("datetime");
    expect(updateAtField["hooks"]?.update).toBeDefined();
  });
});
