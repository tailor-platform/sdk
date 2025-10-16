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
          role: { type: "enum", required: true, array: false },
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

  test("permission schema structure", async () => {
    const { tailordbTypes } = await client.listTailorDBTypes({
      workspaceId,
      namespaceName,
    });

    const salesOrder = tailordbTypes.find((e) => e.name === "SalesOrder");
    expect(salesOrder?.schema?.permission).toBeDefined();

    // Verify create permission structure
    expect(salesOrder?.schema?.permission?.create).toHaveLength(1);
    expect(salesOrder?.schema?.permission?.create?.[0]).toMatchObject({
      conditions: [
        {
          left: { kind: { case: "userField", value: "role" } },
          operator: TailorDBType_Permission_Operator.EQ,
          right: { kind: { case: "value", value: expect.any(Object) } },
        },
      ],
    });

    // Verify read permission structure (contains role-based condition)
    expect(salesOrder?.schema?.permission?.read).toBeDefined();
    const readPermissions = salesOrder?.schema?.permission?.read;
    expect(
      readPermissions?.some((policy) =>
        policy.conditions?.some(
          (cond) =>
            cond.left?.kind?.case === "userField" &&
            cond.left?.kind?.value === "role" &&
            cond.operator === TailorDBType_Permission_Operator.EQ,
        ),
      ),
    ).toBe(true);

    // Verify update permission structure
    expect(salesOrder?.schema?.permission?.update).toHaveLength(1);
    expect(salesOrder?.schema?.permission?.update?.[0]).toMatchObject({
      conditions: [
        {
          left: { kind: { case: "userField", value: "role" } },
          operator: TailorDBType_Permission_Operator.EQ,
          right: { kind: { case: "value", value: expect.any(Object) } },
        },
      ],
    });

    // Verify delete permission structure
    expect(salesOrder?.schema?.permission?.delete).toHaveLength(1);
    expect(salesOrder?.schema?.permission?.delete?.[0]).toMatchObject({
      conditions: [
        {
          left: { kind: { case: "userField", value: "role" } },
          operator: TailorDBType_Permission_Operator.EQ,
          right: { kind: { case: "value", value: expect.any(Object) } },
        },
      ],
    });
  });
});

describe("dataplane", () => {
  const graphQLClient = createGraphQLClient(inject("token"));

  describe("required field", async () => {
    test("providing required field succeeds", async () => {
      const query = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${randomUUID()}@example.com"
            role: ADMIN
          }) {
            id
            name
          }
        }
      `;
      interface Data {
        createUser: {
          id: string;
          name: string;
        };
      }
      const result = await graphQLClient.rawRequest<Data>(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        createUser: {
          id: expect.any(String),
          name: "alice",
        },
      });
    });

    test("omitting required field fails", async () => {
      const query = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${randomUUID()}@example.com"
          }) {
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
            role: USER
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
            role: USER
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
    let customerId: string;

    test("providing valid id succeeds", async () => {
      const createCustomer = gql`
        mutation {
          createCustomer(
            input: {
              name: "customer"
              email: "customer-${randomUUID()}@example.com"
              country: "USA"
              postalCode: "12345"
              state: "California"
            }
          ) {
            id
          }
        }
      `;
      const customerResult = await graphQLClient.rawRequest<{
        createCustomer: { id: string };
      }>(createCustomer);
      expect(customerResult.errors).toBeUndefined();
      customerId = customerResult.data.createCustomer.id;

      const createSalesOrder = gql`
        mutation {
          createSalesOrder(input: {
            customerID: "${customerId}"
          }) {
            id
            customer {
              id
              name
            }
          }
        }
      `;
      const result = await graphQLClient.rawRequest<{
        createSalesOrder: {
          id: string;
          customer: { id: string; name: string };
        };
      }>(createSalesOrder);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        createSalesOrder: {
          id: expect.any(String),
          customer: {
            id: customerId,
            name: "customer",
          },
        },
      });
    });

    test("providing invalid id fails", async () => {
      const query = gql`
        mutation {
          createSalesOrder(input: {
            customerID: "${randomUUID()}"
          }) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeDefined();
    });
  });

  describe("self relation", async () => {
    test("n-1 parent/children work", async () => {
      const createParent = gql`
        mutation {
          createSelfie(input: { name: "parent" }) {
            id
            name
          }
        }
      `;
      const parentRes = await graphQLClient.rawRequest<{
        createSelfie: { id: string; name: string };
      }>(createParent);
      expect(parentRes.errors).toBeUndefined();
      const parentId = parentRes.data.createSelfie.id;

      const createChild = gql`
        mutation {
          createSelfie(input: { name: "child", parentID: "${parentId}" }) {
            id name parent { id name }
          }
        }
      `;
      const childRes = await graphQLClient.rawRequest<{
        createSelfie: { id: string; name: string; parent: { id: string } };
      }>(createChild);
      expect(childRes.errors).toBeUndefined();
      const childId = childRes.data.createSelfie.id;
      expect(childRes.data.createSelfie.parent.id).toBe(parentId);

      const queryParent = gql`
        query {
          selfie(id: "${parentId}") {
            id
            name
            children { edges { node { id name } } }
          }
        }
      `;
      const parentQueryRes = await graphQLClient.rawRequest<{
        selfie: { id: string; children: { edges: { node: { id: string } }[] } };
      }>(queryParent);
      expect(parentQueryRes.errors).toBeUndefined();
      expect(parentQueryRes.data.selfie.children.edges).toEqual(
        expect.arrayContaining([{ node: { id: childId, name: "child" } }]),
      );
    });

    test("1-1 dependsOn/dependedBy work (and uniqueness)", async () => {
      const createA = gql`
        mutation {
          createSelfie(input: { name: "A" }) {
            id
            name
          }
        }
      `;
      const createB = gql`
        mutation {
          createSelfie(input: { name: "B" }) {
            id
            name
          }
        }
      `;
      const [aRes, bRes] = await Promise.all([
        graphQLClient.rawRequest<{ createSelfie: { id: string } }>(createA),
        graphQLClient.rawRequest<{ createSelfie: { id: string } }>(createB),
      ]);
      const aId = aRes.data.createSelfie.id;
      const bId = bRes.data.createSelfie.id;

      const setDepends = gql`
        mutation {
          updateSelfie(id: "${aId}", input: { dependId: "${bId}" }) {
            id
            dependsOn { id name }
          }
        }
      `;
      const setRes = await graphQLClient.rawRequest<{
        updateSelfie: { id: string; dependsOn: { id: string } };
      }>(setDepends);
      expect(setRes.errors).toBeUndefined();
      expect(setRes.data.updateSelfie.dependsOn.id).toBe(bId);

      const queryDependedBy = gql`
        query { selfie(id: "${bId}") { id dependedBy { id name } } }
      `;
      const depByRes = await graphQLClient.rawRequest<{
        selfie: { id: string; dependedBy: { id: string } | null };
      }>(queryDependedBy);
      expect(depByRes.errors).toBeUndefined();
      expect(depByRes.data.selfie.dependedBy?.id).toBe(aId);

      const createC = gql`
        mutation {
          createSelfie(input: { name: "C" }) {
            id
          }
        }
      `;
      const cRes = await graphQLClient.rawRequest<{
        createSelfie: { id: string };
      }>(createC);
      const cId = cRes.data.createSelfie.id;
      const violate = gql`
        mutation { updateSelfie(id: "${cId}", input: { dependId: "${bId}" }) { id } }
      `;
      const violRes = await graphQLClient.rawRequest(violate);
      expect(violRes.errors).toBeDefined();
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
            role: USER
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
          user(id: "${randomUUID()}") {
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

  describe("file", async () => {
    test("file type field returns", async () => {
      const query = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${randomUUID()}@example.com"
            role: USER
          }) {
            id
            name
            avatar {
              url
              contentType
              size
              sha256sum
              lastUploadedAt
              __typename
            }
          }
        }
      `;

      const result = await graphQLClient.rawRequest<{
        createUser: { avatar: { url: string } };
      }>(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toMatchObject({
        createUser: {
          avatar: {
            url: expect.any(String),
            contentType: null,
            size: null,
            sha256sum: null,
            lastUploadedAt: null,
            __typename: "File",
          },
        },
      });
    });
  });
});
