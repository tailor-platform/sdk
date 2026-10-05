import { expect, test } from "vitest";
import { t } from "../../configure/types/type";
import { parseDateFields } from "../../runtime/field-parse";
import { Temporal } from "../../runtime/temporal";
import { parsedAtImport } from "./fixtures/parsed-at-import";

function valueOf<V>(result: { issues?: unknown; value?: V }): V {
  if (result.issues) throw new Error(`Unexpected issues: ${JSON.stringify(result.issues)}`);
  return result.value as V;
}

test("t.date() without `as` parses to Temporal under defaultDateRepresentation: temporal", () => {
  const result = t.date().parse({ value: "2026-10-05", data: {}, invoker: null });
  expect(valueOf(result)).toBeInstanceOf(Temporal.PlainDate);
});

test("the default is in place before the test file's imports evaluate", () => {
  expect(valueOf(parsedAtImport)).toBeInstanceOf(Temporal.PlainDate);
});

test("parseDateFields on a field without `as` follows the default too", () => {
  const payload = t.object({ at: t.datetime(), time: t.time() });
  const result = valueOf(
    parseDateFields(payload, {
      value: { at: "2026-10-05T01:02:03Z", time: "12:30" },
      data: {},
      invoker: null,
    }),
  );
  expect(result.at).toBeInstanceOf(Temporal.Instant);
  expect(result.time).toBeInstanceOf(Temporal.PlainTime);
});

test('an explicit `as: "string"` still yields a string', () => {
  const result = t.date({ as: "string" }).parse({ value: "2026-10-05", data: {}, invoker: null });
  expect(valueOf(result)).toBe("2026-10-05");
});
