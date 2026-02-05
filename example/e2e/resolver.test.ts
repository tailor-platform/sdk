import { randomUUID } from "node:crypto";
import { PipelineResolverView } from "@tailor-platform/tailor-proto/pipeline_pb";
import { gql } from "graphql-request";
import ml from "multiline-ts";
import { describe, expect, inject, test } from "vitest";
import { filterByMetadata, pipelineTrn } from "./metadata";
import { createGraphQLClient, createOperatorClient } from "./utils";

describe("controlplane", async () => {
  const [client, workspaceId] = createOperatorClient();
  const namespaceName = "my-resolver";

  test("service applied", async () => {
    const { pipelineServices } = await client.listPipelineServices({
      workspaceId,
    });
    const ownedServices = await filterByMetadata(client, pipelineServices, pipelineTrn);

    expect(ownedServices.length).toBe(1);
    expect(ownedServices[0].namespace?.name).toBe(namespaceName);
  });

  test("pipeline applied", async () => {
    const { pipelineResolvers } = await client.listPipelineResolvers({
      workspaceId,
      namespaceName,
      pipelineResolverView: PipelineResolverView.FULL,
    });
    expect(pipelineResolvers.length).toBe(6);

    const stepChain = pipelineResolvers.find((e) => e.name === "stepChain");
    expect(stepChain).toMatchObject({
      name: "stepChain",
      description: ml`
        Step chain operation with nested validation

        Returns:
        Result of step chain operation`,
      operationType: "query",
      authorization: "true==true",
      inputs: [
        {
          name: "user",
          description: "User information",
          array: false,
          required: true,
          type: {
            kind: "UserDefined",
            name: "StepChainUser",
            description: "User information",
            fields: expect.any(Array),
          },
        },
      ],
      response: {
        description: "Result of step chain operation",
        array: false,
        required: true,
        type: {
          kind: "UserDefined",
          name: "StepChainOutput",
          description: "Result of step chain operation",
          fields: [
            {
              name: "result",
              description: "Processing result",
              array: false,
              required: true,
              type: {
                kind: "UserDefined",
                name: "StepChainOutputResult",
                description: "Processing result",
                fields: expect.any(Array),
              },
            },
          ],
        },
      },
      pipelines: [{ name: "body" }],
      publishExecutionEvents: true,
    });

    // Verify nested field descriptions in stepChain
    const userInput = stepChain?.inputs?.[0];
    const userFields = userInput?.type?.fields ?? [];

    const nameField = userFields.find((f) => f.name === "name");
    expect(nameField?.description).toBe("User's full name");

    const activatedAtField = userFields.find((f) => f.name === "activatedAt");
    expect(activatedAtField?.description).toBe("User activation timestamp");

    const add = pipelineResolvers.find((e) => e.name === "add");
    expect(add).toMatchObject({
      name: "add",
      description: ml`
        Addition operation

        Returns:
        Sum of the two input numbers`,
      operationType: "query",
      authorization: "true==true",
      inputs: [
        {
          name: "a",
          description: "First number to add",
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
          description: "Second number to add",
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
        description: "Sum of the two input numbers",
        array: false,
        required: true,
        type: {
          kind: "ScalarType",
          name: "Int",
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
    expect(inputNames).toContain("input");

    // Verify field descriptions from TailorDBField
    const inputType = passThrough?.inputs?.find((i) => i.name === "input");
    expect(inputType?.type?.kind).toBe("UserDefined");
    expect(inputType?.type?.name).toBe("PassThroughInput");

    // Verify response field descriptions
    const userInfoResponse = passThrough?.response?.type?.fields?.find(
      (f) => f.name === "userInfo",
    );
    expect(userInfoResponse?.description).toBe("User information");

    const metadataResponse = passThrough?.response?.type?.fields?.find(
      (f) => f.name === "metadata",
    );
    expect(metadataResponse?.description).toBe("Profile metadata");

    const archivedResponse = passThrough?.response?.type?.fields?.find(
      (f) => f.name === "archived",
    );
    expect(archivedResponse?.description).toBe("Archive status");

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
      const createSupplierResult = await graphQLClient.rawRequest(createSupplier);
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

    test("verify userInfo resolver has field descriptions", async () => {
      const [client, workspaceId] = createOperatorClient();
      const namespaceName = "my-resolver";
      const { pipelineResolvers } = await client.listPipelineResolvers({
        workspaceId,
        namespaceName,
        pipelineResolverView: PipelineResolverView.FULL,
      });

      const userInfo = pipelineResolvers.find((e) => e.name === "showUserInfo");
      expect(userInfo).toBeDefined();

      const responseFields = userInfo?.response?.type?.fields ?? [];
      const idField = responseFields.find((f) => f.name === "id");
      expect(idField?.description).toBe("User ID");

      const typeField = responseFields.find((f) => f.name === "type");
      expect(typeField?.description).toBe("User type");

      const workspaceIdField = responseFields.find((f) => f.name === "workspaceId");
      expect(workspaceIdField?.description).toBe("Workspace ID");

      const roleField = responseFields.find((f) => f.name === "role");
      expect(roleField?.description).toBe("User role");
    });
  });

  describe("passThrough", () => {
    test("returns input data as-is with all required fields", async () => {
      const testId = randomUUID();
      const query = gql`
        query {
          passThrough(
            id: "${testId}"
            input: {
              userInfo: {
                name: "John Doe"
                email: "john@example.com"
              }
              metadata: {
                created: "2024-01-01T00:00:00.000Z"
                version: 1
              }
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

    test("verifies output typeName via GraphQL introspection", async () => {
      const introspectionQuery = gql`
        query {
          __type(name: "Query") {
            fields {
              name
              type {
                name
                kind
                ofType {
                  name
                }
              }
            }
          }
        }
      `;
      const result = await graphQLClient.rawRequest(introspectionQuery);
      expect(result.errors).toBeUndefined();

      const queryType = result.data as {
        __type: {
          fields: {
            name: string;
            type: { name: string | null; kind: string; ofType: { name: string } | null };
          }[];
        };
      };
      const passThroughField = queryType.__type.fields.find((f) => f.name === "passThrough");
      expect(passThroughField).toBeDefined();

      // Verify the output type name
      const outputTypeName = passThroughField?.type.name ?? passThroughField?.type.ofType?.name;
      expect(outputTypeName).toBe("NestedProfile");
    });

    test("toResolverOutput produces types matching TailorDB introspection", async () => {
      // Helper to get field type name
      const getTypeName = (
        field: { type: { name: string | null; ofType: { name: string } | null } } | undefined,
      ) => field?.type?.name ?? field?.type?.ofType?.name;

      // Get the passThrough resolver's output type name
      const schemaQuery = gql`
        query {
          __schema {
            queryType {
              fields {
                name
                type {
                  name
                  ofType {
                    name
                  }
                }
              }
            }
          }
        }
      `;
      const schemaResult = await graphQLClient.rawRequest(schemaQuery);
      const queryFields = (
        schemaResult.data as {
          __schema: {
            queryType: {
              fields: {
                name: string;
                type: { name: string | null; ofType: { name: string } | null };
              }[];
            };
          };
        }
      ).__schema.queryType.fields;
      const passThroughField = queryFields.find((f) => f.name === "passThrough");
      const passThroughTypeName = getTypeName(passThroughField);

      // Get nested field types for passThrough output
      const typeQuery = gql`
        query GetType($name: String!) {
          __type(name: $name) {
            fields {
              name
              type {
                name
                ofType {
                  name
                }
              }
            }
          }
        }
      `;
      const passThroughTypeResult = await graphQLClient.rawRequest(typeQuery, {
        name: passThroughTypeName,
      });
      const passThroughFields = (
        passThroughTypeResult.data as {
          __type: {
            fields: {
              name: string;
              type: { name: string | null; ofType: { name: string } | null };
            }[];
          };
        }
      ).__type.fields;

      // Get TailorDB NestedProfile type for comparison
      const tailorDbResult = await graphQLClient.rawRequest(typeQuery, { name: "NestedProfile" });
      const tailorDbFields = (
        tailorDbResult.data as {
          __type: {
            fields: {
              name: string;
              type: { name: string | null; ofType: { name: string } | null };
            }[];
          };
        }
      ).__type.fields;

      // Verify field types match (including backward relations from new types)
      const fieldsToCheck = [
        "userInfo", // nested object
        "metadata", // nested object
        "avatar", // file field
        "ownerID", // n-1 relation (foreign key)
        "owner", // n-1 relation (navigation property)
        "detail", // 1-1 backward relation (from ProfileDetail)
        "comments", // n-1 backward relation (from ProfileComment)
      ];
      for (const fieldName of fieldsToCheck) {
        const passThroughFieldType = getTypeName(
          passThroughFields.find((f) => f.name === fieldName),
        );
        const tailorDbFieldType = getTypeName(tailorDbFields.find((f) => f.name === fieldName));
        expect(passThroughFieldType).toBe(tailorDbFieldType);
      }
    });
  });

  test("env", async () => {
    const query = gql`
      query {
        env(multiplier: 5) {
          result
          envBar
          envBaz
        }
      }
    `;
    const result = await graphQLClient.rawRequest(query);
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      env: {
        result: 5, // 5 * env.foo (1)
        envBar: "hello",
        envBaz: true,
      },
    });
  });

  describe("triggerOrderProcessing", () => {
    test("triggers workflow and returns workflowRunId", async () => {
      const orderId = randomUUID();
      const customerId = randomUUID();

      const mutation = gql`
        mutation {
          triggerOrderProcessing(
            orderId: "${orderId}"
            customerId: "${customerId}"
          ) {
            workflowRunId
            message
          }
        }
      `;
      const result = await graphQLClient.rawRequest(mutation);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({
        triggerOrderProcessing: {
          workflowRunId: expect.any(String),
          message: `Workflow triggered for order ${orderId}`,
        },
      });

      // Verify workflowRunId is a valid UUID
      const workflowRunId = (result.data as { triggerOrderProcessing: { workflowRunId: string } })
        .triggerOrderProcessing.workflowRunId;
      expect(workflowRunId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    test("verify resolver configuration in controlplane", async () => {
      const [client, workspaceId] = createOperatorClient();
      const namespaceName = "my-resolver";
      const { pipelineResolvers } = await client.listPipelineResolvers({
        workspaceId,
        namespaceName,
        pipelineResolverView: PipelineResolverView.FULL,
      });

      const triggerResolver = pipelineResolvers.find((e) => e.name === "triggerOrderProcessing");
      expect(triggerResolver).toBeDefined();
      expect(triggerResolver).toMatchObject({
        name: "triggerOrderProcessing",
        description: "Trigger the order processing workflow",
        operationType: "mutation",
      });

      // Verify inputs
      const inputNames = triggerResolver?.inputs?.map((i) => i.name) ?? [];
      expect(inputNames).toContain("orderId");
      expect(inputNames).toContain("customerId");

      // Verify orderId input
      const orderIdInput = triggerResolver?.inputs?.find((i) => i.name === "orderId");
      expect(orderIdInput?.description).toBe("Order ID to process");
      expect(orderIdInput?.type?.kind).toBe("ScalarType");
      expect(orderIdInput?.type?.name).toBe("String");

      // Verify customerId input
      const customerIdInput = triggerResolver?.inputs?.find((i) => i.name === "customerId");
      expect(customerIdInput?.description).toBe("Customer ID for the order");
      expect(customerIdInput?.type?.kind).toBe("ScalarType");
      expect(customerIdInput?.type?.name).toBe("String");

      // Verify response
      const responseFields = triggerResolver?.response?.type?.fields ?? [];
      const workflowRunIdField = responseFields.find((f) => f.name === "workflowRunId");
      expect(workflowRunIdField).toBeDefined();
      const messageField = responseFields.find((f) => f.name === "message");
      expect(messageField).toBeDefined();
    });
  });
});
