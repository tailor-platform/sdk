import {
  InputType,
  InputTypeField,
  Type,
  TypeField,
  ArrayOf,
  generateSDL,
  generateSDLForType,
  generateSDLForTypeAndDependencies
} from '@tailor-platform/tailor-sdk';
import { describe, expect, test } from 'vitest';


// Define a type to be used as an array element
@Type()
class Product {
  @TypeField({ type: 'uuid' })
  id!: string;

  @TypeField()
  name?: string;

  @TypeField({ type: 'Int' })
  price!: number;

  @TypeField({ type: 'Float', nullable: true })
  weight?: number;
}
const productSDL = `type Product {
  id: ID!
  name: String!
  price: Int!
  weight: Float
}
`

// Define a collection type that includes an array
@Type()
class ProductList {
  @TypeField()
  @ArrayOf(Product) // Explicitly define that this array contains Product elements
  items!: Product[];

  @TypeField({ type: 'Int' })
  totalCount!: number;
}
const productListSDL = `type ProductList {
  items: [Product]!
  totalCount: Int!
}
`;


// Input type with array
@InputType()
class OrderInput {
  @InputTypeField()
  customerId!: string;

  @InputTypeField()
  @ArrayOf(String) // Array of primitive types
  productIds!: string[];
}

const orderInputSDL = `input OrderInput {
  customerId: String!
  productIds: [String]!
}
`

// Complex type hierarchy for testing dependencies
@Type()
class Address {
  @TypeField()
  street!: string;

  @TypeField()
  city!: string;

  @TypeField()
  zipCode!: string;
}

@Type()
class Customer {
  @TypeField({ type: 'uuid' })
  id!: string;

  @TypeField()
  name!: string;

  @TypeField()
  address!: Address;
}

@Type()
class Order {
  @TypeField({ type: 'uuid' })
  id!: string;

  @TypeField()
  customer!: Customer;

  @TypeField()
  @ArrayOf(Product)
  products!: Product[];

  @TypeField({ type: 'Float' })
  totalPrice!: number;
}

describe('Schema generation', () => {
  test("Type Decorators", () => {
    const sdl = generateSDLForType(Product);
    expect(sdl).toBe(productSDL);
  });
  test("Type with List", () => {
    const sdl = generateSDLForType(ProductList);
    expect(sdl).toBe(productListSDL);
  });
  test("Input Decorators", () => {
    const sdl = generateSDLForType(OrderInput);
    expect(sdl).toBe(orderInputSDL);
  });

  test("Generate SDL for all types", () => {
    const allTypesSDL = generateSDL();
    expect(allTypesSDL).toContain(productSDL);
    expect(allTypesSDL).toContain(productListSDL);
    expect(allTypesSDL).toContain(orderInputSDL);
  });

  test("Generate SDL for a type and its dependencies", () => {
    // When we generate SDL for ProductList, it should include Product as well
    const sdl = generateSDLForTypeAndDependencies(ProductList);
    expect(sdl).toContain('type ProductList {');
    expect(sdl).toContain('type Product {');

    // OrderInput has no custom type dependencies, so it should only include itself
    const orderSdl = generateSDLForTypeAndDependencies(OrderInput);
    expect(orderSdl).toBe(orderInputSDL.trim());

    // Test complex type hierarchy with nested dependencies
    const orderWithDependenciesSDL = generateSDLForTypeAndDependencies(Order);
    expect(orderWithDependenciesSDL).toContain('type Order {');
    expect(orderWithDependenciesSDL).toContain('type Customer {');
    expect(orderWithDependenciesSDL).toContain('type Address {');
    expect(orderWithDependenciesSDL).toContain('type Product {');

    // We should be able to start from any type in the hierarchy and get all dependencies
    const customerWithDependenciesSDL = generateSDLForTypeAndDependencies(Customer);
    expect(customerWithDependenciesSDL).toContain('type Customer {');
    expect(customerWithDependenciesSDL).toContain('type Address {');
    expect(customerWithDependenciesSDL).not.toContain('type Product {'); // Customer doesn't reference Product
  });
});
