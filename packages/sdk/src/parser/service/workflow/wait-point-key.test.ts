import { describe, expect, test } from "vitest";
import { checkWaitPointKey, collectWaitPointKeyFailures } from "./wait-point-key";
import type { WaitPointDeclaration } from "#/utils/wait-point-registry";

function check(key: string, declaredBy: WaitPointDeclaration = "createWaitPoint") {
  return checkWaitPointKey({ key, declaredBy });
}

describe("checkWaitPointKey", () => {
  test("accepts a key within the platform grammar", () => {
    expect(check("approval")).toBeUndefined();
    expect(check("line-approval")).toBeUndefined();
    // A run of hyphens is inside the grammar, so it stays valid.
    expect(check("my--step")).toBeUndefined();
  });

  test("rejects keys outside the platform grammar", () => {
    expect(check("myStep")).toContain('segment "myStep"');
    expect(check("my_step")).toContain('segment "my_step"');
    expect(check("ab")).toContain("must match");
    expect(check("-my-step")).toContain("must match");
    expect(check("my-step-")).toContain("must match");
  });

  test("reports a key of only hyphens as a grammar failure, not a $params one", () => {
    // It has no $params, so the literal-segment message would name a feature
    // the key never used.
    expect(check("---")).toContain("must match");
    expect(check("")).toContain("must match");
  });

  test("accepts a $param key declared through define", () => {
    expect(check("line-approval-$lineId", "define")).toBeUndefined();
    expect(check("line--approval-$lineId", "define")).toBeUndefined();
    expect(check("a-$x-b-$y", "define")).toBeUndefined();
  });

  test("rejects a $param key from createWaitPoint, which cannot type it", () => {
    expect(check("line-approval-$lineId")).toContain("Declare it through createWaitPoints instead");
  });

  test("rejects $params taken from a property name", () => {
    expect(check("line-approval-$lineId", "property")).toContain(
      "cannot come from a property name",
    );
  });

  test("rejects property names outside the platform grammar", () => {
    expect(check("lineApproval", "property")).toContain('segment "lineApproval"');
  });

  test("rejects an identity-less key", () => {
    expect(check("$itemId", "define")).toContain("needs at least one literal segment");
  });

  test("reports the grammar first when an identity-less key also breaks it", () => {
    // Adding the literal the identity-less message asks for would leave the
    // leading or trailing hyphen in place, so it would take two rounds.
    expect(check("-$id", "define")).toContain("must match");
    expect(check("$id-", "define")).toContain("must match");
  });

  test("rejects a repeated $param", () => {
    expect(check("a-$x-b-$x", "define")).toContain('parameter "$x" appears more than once');
  });

  test("rejects a $param name outside the identifier grammar", () => {
    expect(check("line-$1", "define")).toContain("is not a usable parameter name");
    // A bare `$` names nothing. The configure side does not read it as a param
    // at all, so this is the only place that reports it.
    expect(check("line-$", "define")).toContain("is not a usable parameter name");
  });

  test("does not blame $params for a bare `$` under a declaration that cannot type them", () => {
    // The key carries no param, so advice about typing $params would send the
    // reader to a different API for a problem it does not solve.
    expect(check("line-$")).not.toContain("Declare it through createWaitPoints instead");
    expect(check("line-$")).toContain("is not a usable parameter name");
    expect(check("line-$", "property")).not.toContain("cannot come from a property name");
  });

  test("rejects a $param key whose fixed part breaks the grammar", () => {
    expect(check("-line-$lineId", "define")).toContain("must match");
    expect(check("line-$lineId-", "define")).toContain("must match");
  });

  test("rejects a key whose literal part cannot fit the limit", () => {
    expect(check(`${"a".repeat(62)}-$id`, "define")).toContain("cannot fit in 63 characters");
  });
});

describe("collectWaitPointKeyFailures", () => {
  test("says nothing when every declaration is usable", () => {
    expect(
      collectWaitPointKeyFailures([
        { key: "approval", declaredBy: "createWaitPoint" },
        { key: "line-approval-$lineId", declaredBy: "define" },
        { key: "manager-approval", declaredBy: "property" },
      ]),
    ).toEqual([]);
  });

  test("judges the same key once per declaration it came from", () => {
    // The valid `define` declaration must not mask the invalid one: only
    // `define` can type $params, so the createWaitPoint entry is still wrong.
    const failures = collectWaitPointKeyFailures([
      { key: "line-approval-$lineId", declaredBy: "define" },
      { key: "line-approval-$lineId", declaredBy: "createWaitPoint" },
    ]);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Declare it through createWaitPoints instead");
  });

  test("reports a repeated declaration only once", () => {
    expect(
      collectWaitPointKeyFailures([
        { key: "myStep", declaredBy: "property" },
        { key: "myStep", declaredBy: "property" },
      ]),
    ).toHaveLength(1);
  });
});
