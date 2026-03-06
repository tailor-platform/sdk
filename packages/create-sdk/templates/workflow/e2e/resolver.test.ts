import { randomUUID } from "node:crypto";
import { gql, GraphQLClient } from "graphql-request";
import { describe, expect, inject, test } from "vitest";

function createGraphQLClient(): GraphQLClient {
  const endpoint = new URL("/query", inject("url")).href;
  return new GraphQLClient(endpoint, {
    headers: {
      Authorization: `Bearer ${inject("token")}`,
    },
    // Prevent throwing errors on GraphQL errors.
    errorPolicy: "all",
  });
}

describe("resolver", () => {
  const graphQLClient = createGraphQLClient();

  describe.sequential("incrementAge", () => {
    const uuid = randomUUID();
    const testEmail = `alice-${uuid}@example.com`;

    test("create test user", async () => {
      const query = gql`
        mutation ($input: UserCreateInput!) {
          createUser(input: $input) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, {
        input: { name: "alice", email: testEmail, age: 30 },
      });
      expect(result.errors).toBeUndefined();
    });

    test("increment age returns old and new values", async () => {
      const query = gql`
        mutation ($email: String!) {
          incrementAge(email: $email) {
            oldAge
            newAge
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, { email: testEmail });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        incrementAge: {
          oldAge: 30,
          newAge: 31,
        },
      });
    });

    test("increment is idempotent per call", async () => {
      const query = gql`
        mutation ($email: String!) {
          incrementAge(email: $email) {
            oldAge
            newAge
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, { email: testEmail });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        incrementAge: {
          oldAge: 31,
          newAge: 32,
        },
      });
    });
  });

  test("incrementAge fails for non-existent user", async () => {
    const query = gql`
      mutation ($email: String!) {
        incrementAge(email: $email) {
          oldAge
          newAge
        }
      }
    `;
    const result = await graphQLClient.rawRequest(query, {
      email: "non-existent@example.com",
    });
    expect(result.errors).toBeDefined();
  });
});
