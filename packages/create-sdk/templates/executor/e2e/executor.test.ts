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

async function waitForAuditLog(
  graphQLClient: GraphQLClient,
  entityId: string,
  action: string,
  timeoutMs = 10000,
): Promise<Record<string, unknown>> {
  const query = gql`
    query ($entityId: ID!, $action: String!) {
      auditLogs(query: { entityId: { eq: $entityId }, action: { eq: $action } }) {
        collection {
          id
          action
          entityType
          entityId
          message
        }
      }
    }
  `;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await graphQLClient.rawRequest(query, { entityId, action });
    const data = result.data as { auditLogs: { collection: Record<string, unknown>[] } };
    if (!result.errors && data.auditLogs.collection.length > 0) {
      return data.auditLogs.collection[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for audit log: entityId=${entityId}, action=${action}`);
}

describe("executor", () => {
  const graphQLClient = createGraphQLClient();

  describe.sequential("record created trigger", () => {
    let userId: string;

    test("creating an admin user triggers audit log", { timeout: 30000 }, async () => {
      const uuid = randomUUID();
      const createQuery = gql`
        mutation ($input: UserCreateInput!) {
          createUser(input: $input) {
            id
          }
        }
      `;
      const createResult = await graphQLClient.rawRequest(createQuery, {
        input: { name: `admin-${uuid}`, email: `admin-${uuid}@example.com`, role: "ADMIN" },
      });
      expect(createResult.errors).toBeUndefined();
      userId = (createResult.data as { createUser: { id: string } }).createUser.id;

      const auditLog = await waitForAuditLog(graphQLClient, userId, "USER_CREATED");
      expect(auditLog.entityType).toBe("User");
      expect(auditLog.message).toContain(`admin-${uuid}`);
    });
  });

  describe.sequential("record updated trigger", () => {
    let userId: string;

    test("updating a user triggers audit log", { timeout: 30000 }, async () => {
      const uuid = randomUUID();

      // Create a user first
      const createQuery = gql`
        mutation ($input: UserCreateInput!) {
          createUser(input: $input) {
            id
          }
        }
      `;
      const createResult = await graphQLClient.rawRequest(createQuery, {
        input: { name: `user-${uuid}`, email: `user-${uuid}@example.com`, role: "MEMBER" },
      });
      expect(createResult.errors).toBeUndefined();
      userId = (createResult.data as { createUser: { id: string } }).createUser.id;

      // Update the user
      const updateQuery = gql`
        mutation ($id: ID!, $input: UserUpdateInput!) {
          updateUser(id: $id, input: $input) {
            id
          }
        }
      `;
      const updateResult = await graphQLClient.rawRequest(updateQuery, {
        id: userId,
        input: { name: `updated-${uuid}` },
      });
      expect(updateResult.errors).toBeUndefined();

      const auditLog = await waitForAuditLog(graphQLClient, userId, "USER_UPDATED");
      expect(auditLog.entityType).toBe("User");
      expect(auditLog.message).toContain(`updated-${uuid}`);
    });
  });
});
