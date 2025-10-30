import { randomUUID } from "node:crypto";
import { PipelineResolverView } from "@tailor-platform/tailor-proto/pipeline_pb";
import { gql } from "graphql-request";
import { describe, expect, inject, test } from "vitest";
import { createGraphQLClient, createOperatorClient } from "./utils";

describe("controlplane", async () => {
  const [client, workspaceId] = createOperatorClient();
  const namespaceName = "my-pipeline";

  test("service applied", async () => {
    const { pipelineServices } = await client.listPipelineServices({
      workspaceId,
    });
    expect(pipelineServices.length).toBe(1);
    expect(pipelineServices[0].namespace?.name).toBe(namespaceName);
  });

  test("pipeline applied", async () => {
    const { pipelineResolvers } = await client.listPipelineResolvers({
      workspaceId,
      namespaceName,
      pipelineResolverView: PipelineResolverView.FULL,
    });
    expect(pipelineResolvers.length).toBe(4);

    const stepChain = pipelineResolvers.find((e) => e.name === "stepChain");
    expect(stepChain).toMatchObject({
      name: "stepChain",
      description: "stepChain resolver",
      operationType: "query",
      authorization: "true==true",
      inputs: [
        {
          name: "user",
          array: false,
          required: true,
          type: {
            kind: "UserDefined",
            name: "StepChainInputUser",
            fields: expect.any(Array),
          },
        },
      ],
      response: {
        array: false,
        required: true,
        type: {
          kind: "UserDefined",
          name: "StepChainOutput",
          fields: [
            {
              name: "result",
              array: false,
              required: true,
              type: {
                kind: "UserDefined",
                name: "StepChainOutputResult",
                fields: expect.any(Array),
              },
            },
          ],
        },
      },
      pipelines: [{ name: "body" }],
      publishExecutionEvents: true,
    });

    const add = pipelineResolvers.find((e) => e.name === "add");
    expect(add).toMatchObject({
      name: "add",
      description: "add resolver",
      operationType: "query",
      authorization: "true==true",
      inputs: [
        {
          name: "a",
          array: false,
          required: true,
          type: {
            kind: "ScalarType",
            name: "Int",
            required: true,
          },
        },
        {
          name: "b",
          array: false,
          required: true,
          type: {
            kind: "ScalarType",
            name: "Int",
            required: true,
          },
        },
      ],
      response: {
        array: false,
        required: true,
        type: {
          kind: "UserDefined",
          name: "AddOutput",
          fields: [
            {
              name: "result",
              array: false,
              required: true,
              type: {
                kind: "ScalarType",
                name: "Int",
              },
            },
          ],
        },
      },
      pipelines: [{ name: "body" }],
      publishExecutionEvents: false,
    });

    const passThrough = pipelineResolvers.find((e) => e.name === "passThrough");
    expect(passThrough).toBeDefined();
    expect(passThrough?.name).toBe("passThrough");
    expect(passThrough?.operationType).toBe("query");
    expect(passThrough?.authorization).toBe("true==true");

    // Verify inputs include expected fields
    const inputNames = passThrough?.inputs?.map((i) => i.name) ?? [];
    expect(inputNames).toContain("id");
    expect(inputNames).toContain("userInfo");
    expect(inputNames).toContain("metadata");
    expect(inputNames).toContain("archived");
    expect(inputNames).toContain("createdAt");
    expect(inputNames).toContain("updatedAt");

    // Verify response structure
    expect(passThrough?.response?.type?.kind).toBe("UserDefined");
    expect(passThrough?.response?.type?.name).toBe("PassThroughOutput");

    const responseFieldNames =
      passThrough?.response?.type?.fields?.map((f) => f.name) ?? [];
    expect(responseFieldNames).toContain("id");
    expect(responseFieldNames).toContain("userInfo");
    expect(responseFieldNames).toContain("metadata");

    expect(passThrough?.pipelines).toBeDefined();
    expect(passThrough?.pipelines?.length).toBe(1);
    expect(passThrough?.pipelines?.[0]?.name).toBe("body");
    expect(passThrough?.publishExecutionEvents).toBe(false);
  });
});

describe("dataplane", () => {
  const graphQLClient = createGraphQLClient(inject("url"), inject("token"));

  describe("stepChain", async () => {
    test("prepare data", async () => {
      const createUser = gql`
        mutation {
          createUser(input: {
            name: "alice"
            email: "alice-${randomUUID()}@example.com"
            role: MANAGER
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
          stepChain(user: { name: { first: "Alice", last: "Smith" } }) {
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
              expect.stringContaining("Alabama"),
            ],
          },
        },
      });
    });

    test("ommiting required fields fails", async () => {
      const query = gql`
        query {
          stepChain(user: { name: { first: "Alice" } }) {
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

  describe("userInfo", async () => {
    test("query user info", async () => {
      const query = gql`
        query {
          showUserInfo {
            id
            type
            workspaceId
            role
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        showUserInfo: {
          id: expect.any(String),
          type: "machine_user",
          workspaceId: expect.any(String),
          role: "MANAGER",
        },
      });
    });
  });

  describe("passThrough", () => {
    test("returns input data as-is with all required fields", async () => {
      const testId = randomUUID();
      const query = gql`
        query {
          passThrough(
            id: "${testId}"
            userInfo: {
              name: "John Doe"
              email: "john@example.com"
            }
            metadata: {
              created: "2024-01-01T00:00:00Z"
              version: 1
            }
          ) {
            id
            userInfo {
              name
              email
              age
              bio
              phone
            }
            metadata {
              created
              lastUpdated
              version
            }
            archived
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        passThrough: {
          id: testId,
          userInfo: {
            name: "John Doe",
            email: "john@example.com",
            age: null,
            bio: null,
            phone: null,
          },
          metadata: {
            created: "2024-01-01T00:00:00Z",
            lastUpdated: null,
            version: 1,
          },
          archived: null,
        },
      });
    });

    test("fails when required field is missing", async () => {
      const query = gql`
        query {
          passThrough(
            userInfo: { name: "Missing Email" }
            metadata: { created: "2024-01-01T00:00:00Z", version: 1 }
          ) {
            userInfo {
              name
              email
            }
            metadata {
              created
              version
            }
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeDefined();
    });

    test("fails when createdAt returns with null", async () => {
      const query = gql`
        query {
          passThrough(
            id: "${randomUUID()}"
            userInfo: {
              name: "John Doe"
              email: "john@example.com"
            }
            metadata: {
              created: "2024-01-01T00:00:00Z"
              version: 1
            }
          ) { createdAt }
        }
      `;
      const result = await graphQLClient.rawRequest(query);
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0].path).toEqual(["passThrough", "createdAt"]);
      expect(result.errors?.[0].message).toMatch(/non-nullable field/);
    });
  });
});
