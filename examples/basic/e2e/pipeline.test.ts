import { randomUUID } from "node:crypto";
import { gql } from "graphql-request";
import { describe, expect, inject, test } from "vitest";

import { createGraphQLClient } from "./utils";

describe("pipeline service", () => {
  const graphQLClient = createGraphQLClient(inject("token"));

  describe("stepChain", async () => {
    test("prepare data", async () => {
      const createRole = gql`
        mutation {
          createRole(input: { name: "admin" }) {
            id
            name
          }
        }
      `;
      interface CreateRole {
        createRole: {
          id: string;
          name: string;
        };
      }
      const createRoleResult =
        await graphQLClient.rawRequest<CreateRole>(createRole);
      expect(createRoleResult.errors).toBeUndefined();
      const roleId = createRoleResult.data.createRole.id;

      const createUser = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${randomUUID()}@example.com"
            roleId: "${roleId}"
          }) {
            id
            name
          }
        }
      `;
      const createUserResult = await graphQLClient.rawRequest(createUser);
      expect(createUserResult.errors).toBeUndefined();

      const createSupplier = gql`
        mutation {
          createSupplier(
            input: {
              name: "Acme Corp"
              phone: "123-456-7890"
              postalCode: "12345"
              country: "USA"
              state: Alabama
              city: "Birmingham"
            }
          ) {
            id
            name
          }
        }
      `;
      const createSupplierResult =
        await graphQLClient.rawRequest(createSupplier);
      expect(createSupplierResult.errors).toBeUndefined();
    });

    test("providing required fields succeeds", async () => {
      const query = gql`
        query {
          stepChain(
            input: { user: { name: { first: "Alice", last: "Smith" } } }
          ) {
            result {
              summary
            }
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        stepChain: {
          result: {
            summary: [
              "step1: Hello Alice Smith on step1!",
              expect.stringContaining("step2"),
              "alice",
              expect.stringContaining("Alabama"),
            ],
          },
        },
      });
    });
  });

  test("ommiting required fields fails", async () => {
    const query = gql`
      query {
        stepChain(input: { user: { name: { first: "Alice" } } }) {
          result {
            summary
          }
        }
      }
    `;
    const result = await graphQLClient.rawRequest(query);
    expect(result.errors).toBeDefined();
  });
});
