import { defineCommand, runCommand } from "politty";
import { CompletionDirective, parseCompletionContext } from "politty/completion";
import { describe, expect, test, vi } from "vitest";
import { applyApiAwareCompletion, generateApiFieldCandidates } from "./completion";
import { apiCommand } from "./index";

const root = defineCommand({
  name: "tailor-sdk",
  description: "test root",
  subCommands: { api: apiCommand },
});

function ctxFor(argv: string[]) {
  return parseCompletionContext(argv, root);
}

describe("generateApiFieldCandidates", () => {
  test("returns undefined for non-api subcommand", () => {
    const r = generateApiFieldCandidates(ctxFor(["", ""]), ["", ""]);
    expect(r).toBeUndefined();
  });

  test("returns undefined when not completing --field value", () => {
    const r = generateApiFieldCandidates(ctxFor(["api", "GetApplication", ""]), [
      "api",
      "GetApplication",
      "",
    ]);
    expect(r).toBeUndefined();
  });

  test("returns undefined when endpoint missing in argv", () => {
    const r = generateApiFieldCandidates(ctxFor(["api", "--field", ""]), ["api", "--field", ""]);
    expect(r).toBeUndefined();
  });

  test("emits top-level field names for --field <empty>", () => {
    const argv = ["api", "GetApplication", "--field", ""];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeDefined();
    if (!r) return;
    const values = r.candidates.map((c) => c.value);
    expect(values).toContain("workspaceId");
    expect(values).toContain("applicationName");
    expect(r.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
  });

  test("emits top-level field names for -f short alias", () => {
    const argv = ["api", "GetApplication", "-f", ""];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeDefined();
    if (!r) return;
    const values = r.candidates.map((c) => c.value);
    expect(values).toContain("workspaceId");
  });

  test("emits message field with trailing dot", () => {
    const argv = ["api", "CreateTailorDBType", "--field", ""];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeDefined();
    if (!r) return;
    const values = r.candidates.map((c) => c.value);
    expect(values).toContain("tailordbType.");
  });

  test("emits nested field names when prefix is dotted", () => {
    const argv = ["api", "CreateTailorDBType", "--field", "tailordbType."];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeDefined();
    if (!r) return;
    const values = r.candidates.map((c) => c.value);
    expect(values.some((v) => v.startsWith("tailordbType.name"))).toBe(true);
  });

  test("returns undefined once user typed past =", () => {
    const argv = ["api", "GetApplication", "--field", "workspaceId=abc"];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeUndefined();
  });

  test("emits candidates for --field=<partial> inline form", () => {
    const argv = ["api", "GetApplication", "--field=app"];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeDefined();
    if (!r) return;
    const values = r.candidates.map((c) => c.value);
    expect(values).toContain("applicationName");
  });

  test("returns undefined for --field=<key>=<partial> inline form", () => {
    const argv = ["api", "GetApplication", "--field=workspaceId=abc"];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeUndefined();
  });

  test("excludes unassignable fields (repeated message) from candidates", () => {
    const argv = ["api", "CreateApplication", "--field", ""];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeDefined();
    if (!r) return;
    const values = r.candidates.map((c) => c.value);
    // subgraphs is `repeated Subgraph` — not assignable via --field, must be hidden.
    expect(values).not.toContain("subgraphs");
    expect(values).not.toContain("subgraphs.");
    // The other repeated-scalar field is still suggested.
    expect(values).toContain("cors");
  });

  test("excludes map fields from candidates", () => {
    const argv = ["api", "SetMetadata", "--field", ""];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeDefined();
    if (!r) return;
    const values = r.candidates.map((c) => c.value);
    // labels is map<string, string> — must be hidden.
    expect(values).not.toContain("labels");
    expect(values).toContain("trn");
  });

  test("excludes google.protobuf well-known type fields from candidates", () => {
    const argv = ["api", "UpdateApplication", "--field", ""];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeDefined();
    if (!r) return;
    const values = r.candidates.map((c) => c.value);
    // updateMask is google.protobuf.FieldMask — must be hidden.
    expect(values).not.toContain("updateMask");
    expect(values).not.toContain("updateMask.");
  });

  test("does not descend into google.protobuf well-known type", () => {
    const argv = ["api", "UpdateApplication", "--field", "updateMask."];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeUndefined();
  });

  test("falls back when method name is unknown", () => {
    const argv = ["api", "NotARealMethod", "--field", ""];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeUndefined();
  });

  test("supports tailor.v1.OperatorService/Method form for endpoint", () => {
    const argv = ["api", "tailor.v1.OperatorService/GetApplication", "--field", ""];
    const r = generateApiFieldCandidates(ctxFor(argv), argv);
    expect(r).toBeDefined();
    if (!r) return;
    const values = r.candidates.map((c) => c.value);
    expect(values).toContain("workspaceId");
  });
});

describe("applyApiAwareCompletion", () => {
  test("registers __complete subcommand that emits api field candidates", async () => {
    const wrapped = defineCommand({
      name: "tailor-sdk",
      description: "test",
      subCommands: { api: apiCommand },
    });
    const wrappedAny = wrapped as { subCommands?: Record<string, unknown> };
    if (!wrappedAny.subCommands) wrappedAny.subCommands = {};
    applyApiAwareCompletion(wrapped);
    const completeCmd = (wrappedAny.subCommands as Record<string, { run?: unknown }>)
      .__complete as Parameters<typeof runCommand>[0];
    expect(completeCmd).toBeDefined();

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCommand(completeCmd, [
        "--shell",
        "bash",
        "--",
        "api",
        "GetApplication",
        "--field",
        "",
      ]);
      const output = consoleLog.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toMatch(/workspaceId/);
      expect(output).toMatch(/applicationName/);
    } finally {
      consoleLog.mockRestore();
    }
  });

  test("falls back to default completion for non-api contexts", async () => {
    const wrapped = defineCommand({
      name: "tailor-sdk",
      description: "test",
      subCommands: { api: apiCommand },
    });
    applyApiAwareCompletion(wrapped);
    const completeCmd = (wrapped as { subCommands: Record<string, unknown> }).subCommands
      .__complete as Parameters<typeof runCommand>[0];

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCommand(completeCmd, ["--shell", "bash", "--", ""]);
      const output = consoleLog.mock.calls.map((c) => String(c[0])).join("\n");
      // Expect a subcommand candidate (api) in the default completion output
      expect(output).toMatch(/api/);
    } finally {
      consoleLog.mockRestore();
    }
  });
});
