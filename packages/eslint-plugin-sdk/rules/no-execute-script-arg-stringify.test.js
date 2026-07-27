/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

describe("no-execute-script-arg-stringify", () => {
  const MESSAGE =
    "executeScript serializes arg internally; pass the value directly instead of JSON.stringify(...) to avoid double-encoding.";

  test("rejects the direct form", () => {
    expectViolation(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ client, workspaceId, name, code, arg: JSON.stringify({ a: 1 }), invoker });',
      "no-execute-script-arg-stringify",
      MESSAGE,
    );
  });

  test("rejects the multi-argument form", () => {
    expectViolation(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ arg: JSON.stringify(payload, null, 2) });',
      "no-execute-script-arg-stringify",
      MESSAGE,
    );
  });

  test("rejects an indirect stringified value held in a variable", () => {
    expectViolation(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nconst serialized = JSON.stringify(payload);\nexecuteScript({ arg: serialized });',
      "no-execute-script-arg-stringify",
      MESSAGE,
    );
  });

  test("rejects a stringified arg in a constant options object", () => {
    expectViolation(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nconst options = { arg: JSON.stringify(payload) };\nexecuteScript(options);',
      "no-execute-script-arg-stringify",
      MESSAGE,
    );
  });

  test("rejects a stringified arg through a transitive const alias of the options object", () => {
    expectViolation(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nconst base = { arg: JSON.stringify(payload) };\nconst options = base;\nexecuteScript(options);',
      "no-execute-script-arg-stringify",
      MESSAGE,
    );
  });

  test("supports namespace imports", () => {
    expectViolation(
      'import * as cli from "@tailor-platform/sdk/cli";\ncli.executeScript({ arg: JSON.stringify(payload) });',
      "no-execute-script-arg-stringify",
      MESSAGE,
    );
  });

  test("accepts an object, array, or primitive arg", () => {
    expectClean(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ arg: { a: 1 } });',
      "no-execute-script-arg-stringify",
    );
    expectClean(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ arg: [1, 2, 3] });',
      "no-execute-script-arg-stringify",
    );
    expectClean(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ arg: true });',
      "no-execute-script-arg-stringify",
    );
    expectClean(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({});',
      "no-execute-script-arg-stringify",
    );
  });

  test("ignores a nested arg key not passed directly to executeScript", () => {
    expectClean(
      'import { executeScript } from "@tailor-platform/sdk/cli";\nexecuteScript({ opts: { arg: JSON.stringify(payload) } });',
      "no-execute-script-arg-stringify",
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { executeScript } from "another-sdk";\nexecuteScript({ arg: JSON.stringify(payload) });',
      "no-execute-script-arg-stringify",
    );
  });
});
