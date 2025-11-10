import { randomUUID } from "node:crypto";
import { gql, GraphQLClient } from "graphql-request";
import { describe, expect, inject, test } from "vitest";

function createGraphQLClient() {
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

  describe("incrementUserAge", () => {
    const uuid = randomUUID();

    test("prepare data", async () => {
      const query = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${uuid}@example.com"
            age: 30
          }) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
    });

    test("basic functionality", async () => {
      const query = gql`
        mutation {
          incrementUserAge(email: "alice-${uuid}@example.com") {
            oldAge
            newAge
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        incrementUserAge: {
          oldAge: 30,
          newAge: 31,
        },
      });
    });
  });
});
