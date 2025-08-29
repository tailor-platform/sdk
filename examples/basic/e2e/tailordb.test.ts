import { randomUUID } from "node:crypto";
import { gql } from "graphql-request";
import { describe, expect, inject, test } from "vitest";

import { TailorDBType_Permission_Operator } from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { createGraphQLClient, createOperatorClient } from "./utils";

describe("controlplane", () => {
  const [client, workspaceId] = createOperatorClient();
  const namespaceName = "tailordb";

  test("service applied", async () => {
    const { tailordbServices } = await client.listTailorDBServices({
      workspaceId,
    });
    expect(tailordbServices.length).toBe(1);
    expect(tailordbServices[0].namespace?.name).toBe(namespaceName);
  });

  test("type applied", async () => {
    const { tailordbTypes } = await client.listTailorDBTypes({
      workspaceId,
      namespaceName,
    });

    const role = tailordbTypes.find((e) => e.name === "Role");
    expect(role).toMatchObject({
      name: "Role",
      schema: {
        fields: {
          name: { type: "string", required: true, array: false },
        },
        relationships: {
          users: {
            refType: "User",
            refField: "roleId",
            srcField: "id",
            array: true,
          },
        },
        permission: {
          create: [
            {
              conditions: [
                {
                  left: { kind: { case: "userField", value: "roleId" } },
                  operator: TailorDBType_Permission_Operator.EQ,
                  right: { kind: { case: "value", value: expect.any(Object) } },
                },
              ],
            },
          ],
          read: [
            {
              conditions: [
                {
                  left: { kind: { case: "userField", value: "roleId" } },
                  operator: TailorDBType_Permission_Operator.EQ,
                  right: { kind: { case: "value", value: expect.any(Object) } },
                },
              ],
            },
            {
              conditions: [
                {
                  left: { kind: { case: "userField", value: "_loggedIn" } },
                  operator: TailorDBType_Permission_Operator.EQ,
                  right: { kind: { case: "value", value: expect.any(Object) } },
                },
              ],
            },
          ],
          update: [
            {
              conditions: [
                {
                  left: { kind: { case: "userField", value: "roleId" } },
                  operator: TailorDBType_Permission_Operator.EQ,
                  right: { kind: { case: "value", value: expect.any(Object) } },
                },
              ],
            },
          ],
          delete: [
            {
              conditions: [
                {
                  left: { kind: { case: "userField", value: "roleId" } },
                  operator: TailorDBType_Permission_Operator.EQ,
                  right: { kind: { case: "value", value: expect.any(Object) } },
                },
              ],
            },
          ],
        },
      },
    });

    const user = tailordbTypes.find((e) => e.name === "User");
    expect(user).toMatchObject({
      name: "User",
      schema: {
        fields: {
          name: { type: "string", required: true, array: false },
          email: {
            type: "string",
            required: true,
            array: false,
            unique: true,
            index: true,
          },
          status: { type: "string", required: false, array: false },
          department: { type: "string", required: false, array: false },
          roleId: { type: "uuid", required: true, array: false },
          createdAt: {
            type: "datetime",
            required: false,
            array: false,
            hooks: expect.any(Object),
          },
          updatedAt: {
            type: "datetime",
            required: false,
            array: false,
            hooks: expect.any(Object),
          },
        },
        relationships: {
          role: {
            refType: "Role",
            refField: "id",
            srcField: "roleId",
            array: false,
          },
        },
        indexes: {
          idx_name_department: {
            fieldNames: ["name", "department"],
            unique: false,
          },
          user_status_created_idx: {
            fieldNames: ["status", "createdAt"],
            unique: false,
          },
        },
      },
    });
  });
});

describe("dataplane", () => {
  const graphQLClient = createGraphQLClient(inject("token"));
  let roleId: string;

  describe("required field", async () => {
    test("providing required field succeeds", async () => {
      const query = gql`
        mutation {
          createRole(input: { name: "admin" }) {
            id
            name
          }
        }
      `;
      interface Data {
        createRole: {
          id: string;
          name: string;
        };
      }
      const result = await graphQLClient.rawRequest<Data>(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        createRole: {
          id: expect.any(String),
          name: "admin",
        },
      });
      roleId = result.data.createRole.id;
    });

    test("omitting required field fails", async () => {
      const query = gql`
        mutation {
          createRole(input: {}) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeDefined();
    });
  });

  describe("unique field", async () => {
    const value = randomUUID();

    test("providing unique value succeeds", async () => {
      const query = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${value}@example.com"
            roleId: "${roleId}"
          }) {
            id
            name
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        createUser: {
          id: expect.any(String),
          name: "alice",
        },
      });
    });

    test("providing duplicate value fails", async () => {
      const query = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${value}@example.com"
            roleId: "${roleId}"
          }) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeDefined();
    });
  });

  describe("relation field", async () => {
    test("providing valid id succeeds", async () => {
      const query = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${randomUUID()}@example.com"
            roleId: "${roleId}"
          }) {
            id
            name
            role {
              id
              name
            }
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        createUser: {
          id: expect.any(String),
          name: "alice",
          role: {
            id: roleId,
            name: "admin",
          },
        },
      });
    });

    test("providing invalid id fails", async () => {
      const query = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${randomUUID()}@example.com"
            roleId: "${randomUUID()}"
          }) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeDefined();
    });
  });

  describe("serial field", async () => {
    test("serial values are set correctly", async () => {
      const createCustomer = gql`
        mutation {
          createCustomer(
            input: {
              name: "customer"
              email: "customer@example.com"
              country: "USA"
              postalCode: "12345"
              state: "California"
            }
          ) {
            id
          }
        }
      `;
      interface CreateCustomer {
        createCustomer: {
          id: string;
        };
      }
      const createCustomerResult =
        await graphQLClient.rawRequest<CreateCustomer>(createCustomer);
      expect(createCustomerResult.errors).toBeUndefined();
      const customerId = createCustomerResult.data.createCustomer.id;

      const createSalesOrder = gql`
        mutation {
          createSalesOrder(input: {
            customerID: "${customerId}"
          }) {
            id
          }
        }
      `;
      interface CreateSalesOrder {
        createSalesOrder: {
          id: string;
        };
      }
      const createSalesOrderResult =
        await graphQLClient.rawRequest<CreateSalesOrder>(createSalesOrder);
      expect(createSalesOrderResult.errors).toBeUndefined();
      const salesOrderId = createSalesOrderResult.data.createSalesOrder.id;

      const createInvoice = gql`
        mutation {
          createInvoice(input: {
            salesOrderID: "${salesOrderId}"
          }) {
            id
            invoiceNumber
            sequentialId
          }
        }
      `;
      const createInvoiceResult = await graphQLClient.rawRequest(createInvoice);
      expect(createInvoiceResult.errors).toBeUndefined();
      expect(createInvoiceResult.data).toEqual({
        createInvoice: {
          id: expect.any(String),
          invoiceNumber: expect.any(String),
          sequentialId: expect.any(Number),
        },
      });
    });
  });

  describe("hooks", async () => {
    test("timestamp fields are set correctly", async () => {
      const create = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${randomUUID()}@example.com"
            roleId: "${roleId}"
          }) {
            id
            name
            createdAt
            updatedAt
          }
        }
      `;
      interface Data {
        createUser: {
          id: string;
          name: string;
          createdAt?: string;
          updatedAt?: string;
        };
      }
      const createResult = await graphQLClient.rawRequest<Data>(create);
      expect(createResult.errors).toBeUndefined();
      expect(createResult.data).toEqual({
        createUser: {
          id: expect.any(String),
          name: "alice",
          createdAt: expect.any(String),
          updatedAt: null,
        },
      });
      const userId = createResult.data.createUser.id;

      const update = gql`
        mutation {
          updateUser(id: "${userId}", input: {}) {
            id
            name
            createdAt
            updatedAt
          }
        }
      `;
      const updateResult = await graphQLClient.rawRequest(update);
      expect(updateResult.errors).toBeUndefined();
      expect(updateResult.data).toEqual({
        updateUser: {
          id: expect.any(String),
          name: "alice",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });
    });

    test("custom hooks execute correctly", async () => {
      const query = gql`
        mutation {
          createCustomer(
            input: {
              name: "customer"
              email: "customer@example.com"
              country: "USA"
              postalCode: "12345"
              address: "123 Main St"
              city: "Los Angeles"
              state: "California"
            }
          ) {
            id
            name
            fullAddress
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        createCustomer: {
          id: expect.any(String),
          name: "customer",
          fullAddress: "〒12345 123 Main St Los Angeles",
        },
      });
    });
  });

  describe("validation", async () => {
    test("providing invalid value fails", async () => {
      const query = gql`
        mutation {
          createCustomer(
            input: {
              name: "bob"
              email: "bob@example.com"
              country: "USA"
              postalCode: "12345"
              state: "California"
            }
          ) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toMatch("longer than 5 characters");
    });
  });

  describe("permission", async () => {
    test("query without token fails", async () => {
      const query = gql`
        query {
          role(id: "${roleId}") {
            id
            name
          }
        }
      `;
      const result = await graphQLClient.rawRequest(
        query,
        {},
        {
          Authorization: "",
        },
      );
      expect(result.errors).toBeDefined();
    });
  });
});
