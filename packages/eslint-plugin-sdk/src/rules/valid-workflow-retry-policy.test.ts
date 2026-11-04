import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "valid-workflow-retry-policy";
const HEAD =
  'import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";\nexport const main = createWorkflowJob({ name: "main", body: () => 1 });\n';
const BACKOFF_ORDER = "initialBackoff must be less than or equal to maxBackoff.";
const MAX_RETRIES_RANGE = "maxRetries must be an integer between 1 and 10.";
const BACKOFF_MULTIPLIER_MIN = "backoffMultiplier must be at least 1.";

function workflow(retryPolicy: string): string {
  return `${HEAD}export default createWorkflow({ name: "wf", mainJob: main, retryPolicy: ${retryPolicy} });`;
}

describe("rejects an initial backoff longer than the maximum backoff", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: workflow(
          '{ maxRetries: 3, initialBackoff: "2m", maxBackoff: "30s", backoffMultiplier: 2 }',
        ),
        errors: [BACKOFF_ORDER],
      },
      {
        code: workflow(
          '{ maxRetries: 3, initialBackoff: "1500ms", maxBackoff: "1s", backoffMultiplier: 2 }',
        ),
        errors: [BACKOFF_ORDER],
      },
    ],
  });
});

describe("rejects per-field values outside the platform limits", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: workflow(
          '{ maxRetries: 0, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }',
        ),
        errors: [MAX_RETRIES_RANGE],
      },
      {
        code: workflow(
          '{ maxRetries: 2.5, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }',
        ),
        errors: [MAX_RETRIES_RANGE],
      },
      {
        code: workflow(
          '{ maxRetries: 3, initialBackoff: "61m", maxBackoff: "120m", backoffMultiplier: 2 }',
        ),
        errors: ["initialBackoff must be at most 3600 seconds."],
      },
      {
        code: workflow(
          '{ maxRetries: 3, initialBackoff: "1s", maxBackoff: "1441m", backoffMultiplier: 2 }',
        ),
        errors: ["maxBackoff must be at most 86400 seconds."],
      },
      {
        code: workflow(
          '{ maxRetries: 3, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 0.5 }',
        ),
        errors: [BACKOFF_MULTIPLIER_MIN],
      },
      {
        code: workflow(
          '{ maxRetries: 3, initialBackoff: "0s", maxBackoff: "30s", backoffMultiplier: 2 }',
        ),
        errors: ['initialBackoff must be a positive duration such as "500ms", "1s", or "1m".'],
      },
    ],
  });
});

describe("rejects negative numeric values", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: workflow(
          '{ maxRetries: -1, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }',
        ),
        errors: [MAX_RETRIES_RANGE],
      },
      {
        code: workflow(
          '{ maxRetries: 3, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: -1 }',
        ),
        errors: [BACKOFF_MULTIPLIER_MIN],
      },
    ],
  });
});

describe("reads the last duplicate key, as the runtime does", () => {
  runRuleTests(RULE, {
    valid: [
      workflow(
        '{ maxRetries: 0, maxRetries: 3, initialBackoff: "2m", initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }',
      ),
    ],
    invalid: [
      {
        code: workflow(
          '{ maxRetries: 3, maxRetries: 0, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }',
        ),
        errors: [MAX_RETRIES_RANGE],
      },
      {
        code: workflow(
          '{ maxRetries: 3, initialBackoff: "1s", initialBackoff: "2m", maxBackoff: "30s", backoffMultiplier: 2 }',
        ),
        errors: [BACKOFF_ORDER],
      },
      {
        code: workflow(
          '{ maxRetries: 3, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2, backoffMultiplier: 0.5 }',
        ),
        errors: [BACKOFF_MULTIPLIER_MIN],
      },
    ],
  });
});

describe("skips a retryPolicy a later spread can override", () => {
  runRuleTests(RULE, {
    valid: [
      `${HEAD}export default createWorkflow({ name: "wf", mainJob: main, retryPolicy: { maxRetries: 0, initialBackoff: "1m", maxBackoff: "1s", backoffMultiplier: 2 }, ...overrides });`,
    ],
  });
});

describe("follows const values and reports each violation once", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${HEAD}const retryPolicy = { maxRetries: 3, initialBackoff: "1m", maxBackoff: "30s", backoffMultiplier: 2 };\nexport default createWorkflow({ name: "wf", mainJob: main, retryPolicy });`,
        errors: [BACKOFF_ORDER],
      },
    ],
  });
});

describe("accepts valid retry policies", () => {
  runRuleTests(RULE, {
    valid: [
      workflow('{ maxRetries: 3, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }'),
      workflow(
        '{ maxRetries: 10, initialBackoff: "60m", maxBackoff: "1440m", backoffMultiplier: 1 }',
      ),
      workflow(
        '{ maxRetries: 1, initialBackoff: "500ms", maxBackoff: "500ms", backoffMultiplier: 1.5 }',
      ),
      `${HEAD}export default createWorkflow({ name: "wf", mainJob: main });`,
    ],
  });
});

describe("skips values it cannot resolve statically", () => {
  runRuleTests(RULE, {
    valid: [
      workflow(
        '{ maxRetries: retries, initialBackoff: initial, maxBackoff: "30s", backoffMultiplier: 2 }',
      ),
      workflow("buildRetryPolicy()"),
      workflow(
        '{ maxRetries: 3, initialBackoff: "1m", maxBackoff: "30s", backoffMultiplier: 2, ...overrides }',
      ),
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createWorkflow } from "another-sdk";\nexport default createWorkflow({ retryPolicy: { maxRetries: 0, initialBackoff: "1m", maxBackoff: "1s", backoffMultiplier: 0 } });',
    ],
  });
});
