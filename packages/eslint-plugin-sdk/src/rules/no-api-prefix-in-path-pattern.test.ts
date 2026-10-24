import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-api-prefix-in-path-pattern";
const MESSAGE = "pathPattern is matched after the /api prefix; remove the leading /api.";

describe.each(['"/api/users/*"', "`/api/orders`"])(
  "rejects the external /api prefix in %s",
  (pattern) => {
    runRuleTests(RULE, {
      invalid: [
        {
          code: `import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: ${pattern} });`,
          errors: [MESSAGE],
        },
      ],
    });
  },
);

describe("accepts relative platform paths and dynamic values", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/users/*" });',
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern });',
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users", pathPattern: "/users" });',
    ],
  });
});

describe("rejects a prefixed path in a constant options object", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { createHttpAdapter } from "@tailor-platform/sdk";\nconst options = { pathPattern: "/api/users/*" };\nexport default createHttpAdapter(options);',
        errors: [MESSAGE],
      },
    ],
  });
});

describe("rejects a prefixed path through a transitive const alias of the options object", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { createHttpAdapter } from "@tailor-platform/sdk";\nconst base = { pathPattern: "/api/users/*" };\nconst options = base;\nexport default createHttpAdapter(options);',
        errors: [MESSAGE],
      },
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createHttpAdapter } from "another-sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users/*" });',
    ],
  });
});

describe("supports namespace imports", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import * as sdk from "@tailor-platform/sdk";\nexport default sdk.createHttpAdapter({ pathPattern: "/api/users/*" });',
        errors: [MESSAGE],
      },
    ],
  });
});
