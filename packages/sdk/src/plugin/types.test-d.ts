import { assertType, describe, test } from "vitest";
import type { JsonValue } from "#/types/helpers";
import type { DeployedHookResult, PluginOutputValue } from "./types";

interface FrontendResult {
  site: string;
  url: string;
}
interface Call {
  caller: string;
  call: string;
  then: string;
  toJSON: string;
  length: number;
  name: string;
}
type FrontendResultAlias = { site: string; url: string };
class Dto {
  value = 1;
}

declare const frontend: FrontendResult;
declare const call: Call;
declare const alias: FrontendResultAlias;
declare const json: Record<string, JsonValue>;
declare const byName: Record<string, FrontendResult>;
declare const date: Date;

describe("DeployedHookResult outputs", () => {
  test("accepts interface-typed values, arrays of them, and records of them", () => {
    assertType<DeployedHookResult>({ outputs: { result: frontend } });
    assertType<DeployedHookResult>({ outputs: { results: [frontend] } });
    assertType<DeployedHookResult>({ outputs: { byName } });
  });

  test("accepts interfaces whose fields share names with function or promise members", () => {
    assertType<DeployedHookResult>({ outputs: { call } });
  });

  test("accepts object literals, type alias values, and JsonValue records", () => {
    assertType<DeployedHookResult>({ outputs: { nested: { list: [1, "a", true, null] } } });
    assertType<DeployedHookResult>({ outputs: { alias } });
    assertType<DeployedHookResult>({ outputs: json });
  });

  test("rejects values that are not JSON at the top level of an output", () => {
    // @ts-expect-error a Date is serialized as a string, not kept as a Date
    assertType<DeployedHookResult>({ outputs: { at: date } });
    // @ts-expect-error functions are not JSON values
    assertType<DeployedHookResult>({ outputs: { fn: () => 1 } });
    // @ts-expect-error class constructors are functions
    assertType<DeployedHookResult>({ outputs: { type: Dto } });
    // @ts-expect-error a Map serializes to an empty object
    assertType<DeployedHookResult>({ outputs: { map: new Map<string, string>() } });
    // @ts-expect-error a Set serializes to an empty object
    assertType<DeployedHookResult>({ outputs: { set: new Set<string>() } });
    // @ts-expect-error a Promise must be awaited before it is returned
    assertType<DeployedHookResult>({ outputs: { pending: Promise.resolve(1) } });
    // @ts-expect-error a RegExp serializes to an empty object
    assertType<DeployedHookResult>({ outputs: { pattern: /x/ } });
    // @ts-expect-error typed arrays are not JSON arrays
    assertType<DeployedHookResult>({ outputs: { bytes: new Uint8Array() } });
    // @ts-expect-error undefined is not a JSON value
    assertType<DeployedHookResult>({ outputs: { missing: undefined } });
    // @ts-expect-error bigint is not a JSON value
    assertType<DeployedHookResult>({ outputs: { size: 1n } });
    // @ts-expect-error symbols are not JSON values
    assertType<DeployedHookResult>({ outputs: { key: Symbol("x") } });
  });

  test("rejects non-JSON values nested in literals", () => {
    // @ts-expect-error a Date inside an array literal
    assertType<DeployedHookResult>({ outputs: { dates: [date] } });
    // @ts-expect-error a Date inside an object literal
    assertType<DeployedHookResult>({ outputs: { event: { when: date } } });
  });

  test("rejects outputs that are not an object", () => {
    // @ts-expect-error outputs is keyed by output name
    assertType<DeployedHookResult>({ outputs: [frontend] });
  });

  test("names the output value type independently of the hook", () => {
    assertType<PluginOutputValue>(frontend);
  });
});
