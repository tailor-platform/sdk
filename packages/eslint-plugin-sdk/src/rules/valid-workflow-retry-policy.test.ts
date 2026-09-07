/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

const RULE = "valid-workflow-retry-policy";
const HEAD =
  'import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";\nexport const main = createWorkflowJob({ name: "main", body: () => 1 });\n';

function workflow(retryPolicy: string): string {
  return `${HEAD}export default createWorkflow({ name: "wf", mainJob: main, retryPolicy: ${retryPolicy} });`;
}

describe("valid-workflow-retry-policy", () => {
  test("rejects an initial backoff longer than the maximum backoff", () => {
    expectViolation(
      workflow('{ maxRetries: 3, initialBackoff: "2m", maxBackoff: "30s", backoffMultiplier: 2 }'),
      RULE,
      "initialBackoff must be less than or equal to maxBackoff",
    );
    expectViolation(
      workflow(
        '{ maxRetries: 3, initialBackoff: "1500ms", maxBackoff: "1s", backoffMultiplier: 2 }',
      ),
      RULE,
      "initialBackoff must be less than or equal to maxBackoff",
    );
  });

  test("rejects per-field values outside the platform limits", () => {
    expectViolation(
      workflow('{ maxRetries: 0, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }'),
      RULE,
      "maxRetries must be an integer between 1 and 10",
    );
    expectViolation(
      workflow(
        '{ maxRetries: 2.5, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }',
      ),
      RULE,
      "maxRetries must be an integer between 1 and 10",
    );
    expectViolation(
      workflow(
        '{ maxRetries: 3, initialBackoff: "61m", maxBackoff: "120m", backoffMultiplier: 2 }',
      ),
      RULE,
      "initialBackoff must be at most 3600 seconds",
    );
    expectViolation(
      workflow(
        '{ maxRetries: 3, initialBackoff: "1s", maxBackoff: "1441m", backoffMultiplier: 2 }',
      ),
      RULE,
      "maxBackoff must be at most 86400 seconds",
    );
    expectViolation(
      workflow(
        '{ maxRetries: 3, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 0.5 }',
      ),
      RULE,
      "backoffMultiplier must be at least 1",
    );
    expectViolation(
      workflow('{ maxRetries: 3, initialBackoff: "0s", maxBackoff: "30s", backoffMultiplier: 2 }'),
      RULE,
      "initialBackoff must be a positive duration",
    );
  });

  test("rejects negative numeric values", () => {
    expectViolation(
      workflow('{ maxRetries: -1, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }'),
      RULE,
      "maxRetries must be an integer between 1 and 10",
    );
    expectViolation(
      workflow('{ maxRetries: 3, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: -1 }'),
      RULE,
      "backoffMultiplier must be at least 1",
    );
  });

  test("skips a retryPolicy a later spread can override", () => {
    expectClean(
      `${HEAD}export default createWorkflow({ name: "wf", mainJob: main, retryPolicy: { maxRetries: 0, initialBackoff: "1m", maxBackoff: "1s", backoffMultiplier: 2 }, ...overrides });`,
      RULE,
    );
  });

  test("follows const values and reports each violation once", () => {
    expectViolation(
      `${HEAD}const retryPolicy = { maxRetries: 3, initialBackoff: "1m", maxBackoff: "30s", backoffMultiplier: 2 };\nexport default createWorkflow({ name: "wf", mainJob: main, retryPolicy });`,
      RULE,
      "initialBackoff must be less than or equal to maxBackoff",
    );
  });

  test("accepts valid retry policies", () => {
    expectClean(
      workflow('{ maxRetries: 3, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }'),
      RULE,
    );
    expectClean(
      workflow(
        '{ maxRetries: 10, initialBackoff: "60m", maxBackoff: "1440m", backoffMultiplier: 1 }',
      ),
      RULE,
    );
    expectClean(
      workflow(
        '{ maxRetries: 1, initialBackoff: "500ms", maxBackoff: "500ms", backoffMultiplier: 1.5 }',
      ),
      RULE,
    );
    expectClean(`${HEAD}export default createWorkflow({ name: "wf", mainJob: main });`, RULE);
  });

  test("skips values it cannot resolve statically", () => {
    expectClean(
      workflow(
        '{ maxRetries: retries, initialBackoff: initial, maxBackoff: "30s", backoffMultiplier: 2 }',
      ),
      RULE,
    );
    expectClean(workflow("buildRetryPolicy()"), RULE);
    expectClean(
      workflow(
        '{ maxRetries: 3, initialBackoff: "1m", maxBackoff: "30s", backoffMultiplier: 2, ...overrides }',
      ),
      RULE,
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { createWorkflow } from "another-sdk";\nexport default createWorkflow({ retryPolicy: { maxRetries: 0, initialBackoff: "1m", maxBackoff: "1s", backoffMultiplier: 0 } });',
      RULE,
    );
  });
});
