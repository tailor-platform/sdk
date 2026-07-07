import {
  ExecutorTargetType,
  ExecutorTriggerType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import { gql } from "graphql-request";
import { describe, expect, inject, test } from "vitest";
import { createGraphQLClient, createOperatorClient } from "./utils";

describe("controlplane", async () => {
  const [client, workspaceId] = createOperatorClient();

  test("executor applied", async () => {
    const { executors } = await client.listExecutorExecutors({ workspaceId });
    expect(executors.length).toBe(6);

    const salesOrderCreated = executors.find((e) => e.name === "sales-order-created");
    expect(salesOrderCreated).toMatchObject({
      name: "sales-order-created",
      description: "Triggered when a new sales order is created",
      disabled: false,
      triggerType: ExecutorTriggerType.EVENT,
      triggerConfig: {
        config: {
          case: "event",
          value: {
            typedConfig: {
              case: "tailordb",
              value: {
                eventTypes: ["tailordb.type_record.created"],
                namespaceName: "tailordb",
                typeName: "SalesOrder",
                condition: expect.any(Object),
              },
            },
          },
        },
      },
      targetType: ExecutorTargetType.TAILOR_GRAPHQL,
      targetConfig: {
        config: {
          case: "tailorGraphql",
          value: {
            appName: "my-app",
            query: expect.stringContaining("createSalesOrderCreated"),
            variables: expect.any(Object),
          },
        },
      },
    });

    const stepChainExecuted = executors.find((e) => e.name === "step-chain-executed");
    expect(stepChainExecuted).toMatchObject({
      name: "step-chain-executed",
      description: "Triggered when a step chain is executed",
      disabled: true,
      triggerType: ExecutorTriggerType.EVENT,
      triggerConfig: {
        config: {
          case: "event",
          value: {
            typedConfig: {
              case: "pipeline",
              value: {
                eventTypes: ["pipeline.resolver.executed"],
                namespaceName: "my-resolver",
                resolverName: "stepChain",
                condition: expect.any(Object),
              },
            },
          },
        },
      },
      targetType: ExecutorTargetType.WEBHOOK,
      targetConfig: {
        config: {
          case: "webhook",
          value: {
            url: expect.any(Object),
            headers: expect.arrayContaining([
              expect.objectContaining({
                key: "Content-Type",
                value: expect.objectContaining({
                  case: "rawValue",
                  value: "application/json",
                }),
              }),
              expect.objectContaining({
                key: "Authorization",
                value: expect.objectContaining({
                  case: "secretValue",
                  value: expect.objectContaining({
                    vaultName: "my-vault",
                    secretKey: "my-secret",
                  }),
                }),
              }),
            ]),
            body: expect.any(Object),
          },
        },
      },
    });

    const userChanged = executors.find((e) => e.name === "user-changed");
    expect(userChanged).toMatchObject({
      name: "user-changed",
      description: "Triggered when a user is created or updated",
      disabled: false,
      triggerType: ExecutorTriggerType.EVENT,
      triggerConfig: {
        config: {
          case: "event",
          value: {
            typedConfig: {
              case: "tailordb",
              value: {
                eventTypes: ["tailordb.type_record.created", "tailordb.type_record.updated"],
                namespaceName: "tailordb",
                typeName: "User",
              },
            },
          },
        },
      },
      targetType: ExecutorTargetType.FUNCTION,
    });

    const userCreated = executors.find((e) => e.name === "user-created");
    expect(userCreated).toMatchObject({
      name: "user-created",
      description: "Triggered when a new user is created",
      disabled: false,
      triggerType: ExecutorTriggerType.EVENT,
      triggerConfig: {
        config: {
          case: "event",
          value: {
            typedConfig: {
              case: "tailordb",
              value: {
                eventTypes: ["tailordb.type_record.created"],
                namespaceName: "tailordb",
                typeName: "User",
                condition: expect.any(Object),
              },
            },
          },
        },
      },
      targetType: ExecutorTargetType.FUNCTION,
      targetConfig: {
        config: {
          case: "function",
          value: {
            name: "operation",
            script: expect.any(String),
            variables: expect.any(Object),
          },
        },
      },
    });
  });
});

describe("dataplane", () => {
  const graphQLClient = createGraphQLClient(inject("url"), inject("token"));

  describe("sales-order-created", async () => {
    let salesOrderId: string;

    test("triggered", async () => {
      const createCustomer = gql`
        mutation {
          createCustomer(
            input: {
              name: "customer"
              email: "customer@example.com"
              country: "USA"
              postalCode: "12345"
              fullAddress: "12345 USA"
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
      const createCustomerResult = await graphQLClient.rawRequest<CreateCustomer>(createCustomer);
      expect(createCustomerResult.errors).toBeUndefined();
      const customerId = createCustomerResult.data.createCustomer.id;

      const createSalesOrder = gql`
        mutation {
          createSalesOrder(input: {
            customerID: "${customerId}"
            totalPrice: 2000000
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
      salesOrderId = createSalesOrderResult.data.createSalesOrder.id;
    });

    test("event created", { timeout: 90_000 }, async () => {
      const query = gql`
        query {
          salesOrderCreatedList(query: { salesOrderID: { eq: "${salesOrderId}" } }) {
            edges {
              node {
                id
              }
            }
          }
        }
      `;
      interface Data {
        salesOrderCreatedList: {
          edges: {
            node: {
              id: string;
            };
          }[];
        };
      }
      // Use poll to wait until the event is created.
      await expect
        .poll(
          async () => {
            const result = await graphQLClient.rawRequest<Data>(query);
            return result.data.salesOrderCreatedList.edges.length;
          },
          { timeout: 90_000, interval: 3_000 },
        )
        .toEqual(1);
    });
  });
});
