import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-execute-script-arg-stringify";
const MESSAGE =
  "executeScript serializes arg internally; pass the value directly instead of JSON.stringify(...) to avoid double-encoding.";

describe("rejects the direct form", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ client, workspaceId, name, code, arg: JSON.stringify({ a: 1 }), invoker });',
        errors: [MESSAGE],
      },
    ],
  });
});

describe("rejects the multi-argument form", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ arg: JSON.stringify(payload, null, 2) });',
        errors: [MESSAGE],
      },
    ],
  });
});

describe("rejects an indirect stringified value held in a variable", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { executeScript } from "@tailor-platform/sdk/cli";\nconst serialized = JSON.stringify(payload);\nexecuteScript({ arg: serialized });',
        errors: [MESSAGE],
      },
    ],
  });
});

describe("rejects a stringified arg in a constant options object", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { executeScript } from "@tailor-platform/sdk/cli";\nconst options = { arg: JSON.stringify(payload) };\nexecuteScript(options);',
        errors: [MESSAGE],
      },
    ],
  });
});

describe("rejects a stringified arg through a transitive const alias of the options object", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { executeScript } from "@tailor-platform/sdk/cli";\nconst base = { arg: JSON.stringify(payload) };\nconst options = base;\nexecuteScript(options);',
        errors: [MESSAGE],
      },
    ],
  });
});

describe("supports namespace imports", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import * as cli from "@tailor-platform/sdk/cli";\ncli.executeScript({ arg: JSON.stringify(payload) });',
        errors: [MESSAGE],
      },
    ],
  });
});

describe("accepts an object, array, or primitive arg", () => {
  runRuleTests(RULE, {
    valid: [
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ arg: { a: 1 } });',
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ arg: [1, 2, 3] });',
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ arg: true });',
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({});',
    ],
  });
});

describe("ignores a nested arg key not passed directly to executeScript", () => {
  runRuleTests(RULE, {
    valid: [
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ opts: { arg: JSON.stringify(payload) } });',
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { executeScript } from "another-sdk";\nexecuteScript({ arg: JSON.stringify(payload) });',
    ],
  });
});
