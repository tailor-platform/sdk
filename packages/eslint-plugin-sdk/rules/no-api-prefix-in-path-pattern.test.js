/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

describe("no-api-prefix-in-path-pattern", () => {
  test.each(['"/api/users/*"', "`/api/orders`"])(
    "rejects the external /api prefix in %s",
    (pattern) => {
      expectViolation(
        `import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: ${pattern} });`,
        "no-api-prefix-in-path-pattern",
        "pathPattern is matched after the /api prefix; remove the leading /api.",
      );
    },
  );

  test("accepts relative platform paths and dynamic values", () => {
    expectClean(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/users/*" });',
      "no-api-prefix-in-path-pattern",
    );
    expectClean(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern });',
      "no-api-prefix-in-path-pattern",
    );
    expectClean(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users", pathPattern: "/users" });',
      "no-api-prefix-in-path-pattern",
    );
  });

  test("rejects a prefixed path in a constant options object", () => {
    expectViolation(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nconst options = { pathPattern: "/api/users/*" };\nexport default createHttpAdapter(options);',
      "no-api-prefix-in-path-pattern",
      "pathPattern is matched after the /api prefix; remove the leading /api.",
    );
  });

  test("rejects a prefixed path through a transitive const alias of the options object", () => {
    expectViolation(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nconst base = { pathPattern: "/api/users/*" };\nconst options = base;\nexport default createHttpAdapter(options);',
      "no-api-prefix-in-path-pattern",
      "pathPattern is matched after the /api prefix; remove the leading /api.",
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { createHttpAdapter } from "another-sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users/*" });',
      "no-api-prefix-in-path-pattern",
    );
  });

  test("supports namespace imports", () => {
    expectViolation(
      'import * as sdk from "@tailor-platform/sdk";\nexport default sdk.createHttpAdapter({ pathPattern: "/api/users/*" });',
      "no-api-prefix-in-path-pattern",
      "pathPattern is matched after the /api prefix; remove the leading /api.",
    );
  });
});
