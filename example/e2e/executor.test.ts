import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  type ExecutorJob,
  ExecutorJobStatus,
  ExecutorTargetType,
  ExecutorTriggerType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import { gql } from "graphql-request";
import { describe, expect, inject, test } from "vitest";
import { createGraphQLClient, createOperatorClient } from "./utils";

describe("controlplane", async () => {
  const [client, workspaceId] = createOperatorClient();

  test("executor applied", async () => {
    const { executors } = await client.listExecutorExecutors({ workspaceId });
    expect(executors.length).toBe(9);

    // A disabled executor is still deployed, trigger and all.
    expect(
      executors
        .filter((e) => e.disabled)
        .map((e) => e.name)
        .toSorted(),
    ).toEqual([
      "audit-trail-created",
      "audit-workflow-completed",
      "idp-user-created",
      "step-chain-executed",
    ]);

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
  const [client, workspaceId] = createOperatorClient();

  describe("sales-order-created", async () => {
    const executorName = "sales-order-created";
    const pollTimeoutMs = 90_000;
    const jobReportTimeoutMs = 20_000;
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

    test("event created", { timeout: pollTimeoutMs + jobReportTimeoutMs + 10_000 }, async () => {
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
      try {
        // Use poll to wait until the event is created.
        await expect
          .poll(
            async () => {
              const result = await graphQLClient.rawRequest<Data>(query);
              expect(result.errors).toBeUndefined();
              return result.data.salesOrderCreatedList.edges.length;
            },
            { timeout: pollTimeoutMs, interval: 3_000 },
          )
          .toEqual(1);
      } catch (error) {
        throw new Error(await fetchJobReport(salesOrderId), { cause: error });
      }
    });

    async function fetchJobReport(recordId: string): Promise<string> {
      const signal = AbortSignal.timeout(jobReportTimeoutMs);
      const listedAt = new Date();
      const jobs: ExecutorJob[] = [];
      let recordJob: ExecutorJob | undefined;
      let listError: string | undefined;
      try {
        let pageToken = "";
        do {
          const page = await client.listExecutorJobs(
            {
              workspaceId,
              executorName,
              pageToken,
              pageSize: 100,
              pageDirection: PageDirection.DESC,
            },
            { signal },
          );
          jobs.push(...page.jobs);
          recordJob = page.jobs.find((job) => jobRecordId(job) === recordId);
          pageToken = page.nextPageToken;
        } while (!recordJob && pageToken);
      } catch (error) {
        if (jobs.length === 0) {
          return `Could not list ${executorName} jobs: ${String(error)}`;
        }
        listError = String(error);
      }

      const lines = [`${executorName} jobs as of ${listedAt.toISOString()}, newest first:`];
      for (const job of jobs.slice(0, 20)) {
        lines.push(`  ${formatJob(job)}`);
      }
      if (!recordJob) {
        lines.push(
          listError === undefined
            ? `No job for record ${recordId}.`
            : `No job for record ${recordId} in the newest ${jobs.length} jobs; could not list older ones: ${listError}`,
        );
        return lines.join("\n");
      }

      try {
        const { attempts } = await client.listExecutorJobAttempts(
          { workspaceId, jobId: recordJob.id },
          { signal },
        );
        lines.push(`Job ${formatJob(recordJob)} has ${attempts.length} attempt(s):`);
        for (const attempt of attempts) {
          lines.push(
            `  ${ExecutorJobStatus[attempt.status]} started ${formatTimestamp(attempt.startedAt)} finished ${formatTimestamp(attempt.finishedAt)}${attempt.error ? `: ${attempt.error}` : ""}`,
          );
        }
      } catch (error) {
        lines.push(`Could not list attempts of job ${formatJob(recordJob)}: ${String(error)}`);
      }
      return lines.join("\n");
    }
  });
});

function formatJob(job: ExecutorJob): string {
  return `${job.id} ${ExecutorJobStatus[job.status]} created ${formatTimestamp(job.createdAt)} for record ${jobRecordId(job) ?? "-"}`;
}

function jobRecordId(job: ExecutorJob): string | undefined {
  const newRecord = job.data?.newRecord;
  if (typeof newRecord !== "object" || newRecord === null || Array.isArray(newRecord)) {
    return undefined;
  }
  return typeof newRecord.id === "string" ? newRecord.id : undefined;
}

function formatTimestamp(timestamp: Timestamp | undefined): string {
  return timestamp ? timestampDate(timestamp).toISOString() : "-";
}
