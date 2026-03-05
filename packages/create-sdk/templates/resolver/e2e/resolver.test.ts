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

  test("add returns sum of two numbers", async () => {
    const query = gql`
      query ($left: Int!, $right: Int!) {
        add(left: $left, right: $right)
      }
    `;
    const result = await graphQLClient.rawRequest(query, { left: 3, right: 7 });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ add: 10 });
  });

  describe.sequential("incrementUserAge", () => {
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
          incrementUserAge(email: $email) {
            oldAge
            newAge
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, { email: testEmail });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        incrementUserAge: {
          oldAge: 30,
          newAge: 31,
        },
      });
    });
  });

  test("showUserInfo returns current user context", async () => {
    const query = gql`
      query {
        showUserInfo {
          userId
          userType
          workspaceId
        }
      }
    `;
    const result = await graphQLClient.rawRequest(query);
    expect(result.errors).toBeUndefined();
    const data = result.data as {
      showUserInfo: { userId: string; userType: string; workspaceId: string };
    };
    expect(data.showUserInfo.userId).toBeDefined();
    expect(data.showUserInfo.userType).toBeDefined();
    expect(data.showUserInfo.workspaceId).toBeDefined();
  });

  test("showEnv returns environment values from config", async () => {
    const query = gql`
      query {
        showEnv {
          appName
          version
        }
      }
    `;
    const result = await graphQLClient.rawRequest(query);
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      showEnv: {
        appName: "Resolver Template",
        version: 1,
      },
    });
  });

  describe.sequential("decrementUserAge", () => {
    const uuid = randomUUID();
    const testEmail = `bob-${uuid}@example.com`;

    test("create test user", async () => {
      const query = gql`
        mutation ($input: UserCreateInput!) {
          createUser(input: $input) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, {
        input: { name: "bob", email: testEmail, age: 25 },
      });
      expect(result.errors).toBeUndefined();
    });

    test("decrement age returns old and new values", async () => {
      const query = gql`
        mutation ($email: String!) {
          decrementUserAge(email: $email) {
            oldAge
            newAge
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, { email: testEmail });
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        decrementUserAge: {
          oldAge: 25,
          newAge: 24,
        },
      });
    });
  });
});
