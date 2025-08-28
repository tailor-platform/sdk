import { gql } from "graphql-request";
import { describe, expect, inject, test } from "vitest";

import { createGraphQLClient } from "./utils";

describe("executor service", () => {
  const graphQLClient = createGraphQLClient(inject("token"));

  describe("record trigger", async () => {
    let salesOrderId: string;

    test("trigger execution", async () => {
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

    test("event created correctly", async () => {
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
          {
            timeout: 60_000,
            interval: 1_000,
          },
        )
        .toEqual(1);
    });
  });
});
