import { generateCompletion } from "politty";
import {
  CompletionDirective,
  extractCompletionData,
  generateCandidates,
  parseCompletionContext,
} from "politty/completion";
import { describe, expect, test, vi } from "vitest";
import { mainCommand } from "./index";

vi.mock("node:module", async (importOriginal) => ({
  ...(await importOriginal()),
  register: vi.fn(),
}));

vi.mock("politty", async (importOriginal) => ({
  ...(await importOriginal()),
  runMain: vi.fn(),
}));

async function complete(args: string[]) {
  const ctx = parseCompletionContext(args, mainCommand);
  return generateCandidates(ctx, { shell: "bash" });
}

async function completeValues(args: string[]) {
  const result = await complete(args);
  return result.candidates.map((c) => c.value);
}

describe("shell completion", () => {
  describe("subcommand completion", () => {
    test("completes root subcommands", async () => {
      const values = await completeValues([""]);
      expect(values).toContain("deploy");
      expect(values).toContain("generate");
      expect(values).toContain("tailordb");
      expect(values).toContain("workspace");
      expect(values).toContain("completion");
    });

    test("completes nested subcommands for tailordb", async () => {
      const values = await completeValues(["tailordb", ""]);
      expect(values).toContain("erd");
      expect(values).toContain("migration");
      expect(values).toContain("truncate");
    });
  });

  describe("option name completion", () => {
    test("completes option names for deploy command", async () => {
      const values = await completeValues(["deploy", "--"]);
      expect(values).toContain("--config");
      expect(values).toContain("--workspace-id");
      expect(values).toContain("--profile");
      expect(values).toContain("--yes");
    });

    test("completes option names for workspace create command", async () => {
      const values = await completeValues(["workspace", "create", "--"]);
      expect(values).toContain("--name");
      expect(values).toContain("--region");
      expect(values).toContain("--delete-protection");
    });
  });

  describe("file completion", () => {
    test("triggers file completion with extension filter for --config", async () => {
      const result = await complete(["deploy", "--config", ""]);

      // With extensions set, politty uses @ext: metadata instead of FileCompletion directive
      expect(result.fileExtensions).toEqual(["ts"]);
    });

    // --env-file and --env-file-if-exists are global args (via runMain's globalArgs),
    // so they are not visible through the low-level parseCompletionContext API.
  });

  describe("directory completion", () => {
    test.each([
      ["staticwebsite deploy --dir", ["staticwebsite", "deploy", "--dir", ""]],
      ["tailordb erd export --output", ["tailordb", "erd", "export", "--output", ""]],
    ])("triggers directory completion for %s", async (_label, args) => {
      const result = await complete(args);
      expect(result.directive & CompletionDirective.DirectoryCompletion).toBeTruthy();
    });
  });

  describe("no file completion", () => {
    test.each([["--workspace-id"], ["--profile"]])(
      "suppresses file completion for %s",
      async (flag) => {
        const result = await complete(["deploy", flag, ""]);
        expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
      },
    );
  });

  describe("enum completion", () => {
    test("completes role values for workspace user invite", async () => {
      const result = await complete(["workspace", "user", "invite", "--role", ""]);
      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("admin");
      expect(values).toContain("editor");
      expect(values).toContain("viewer");
      expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
    });
  });

  describe("api --field expand completion", () => {
    // `--field` uses politty's `expand` variant: candidates are pre-enumerated
    // at script-generation time keyed by the `endpoint` positional. The
    // dynamic `generateCandidates` path returns no candidates for expand —
    // candidates live in the resolved `valueCompletion.table` instead, and
    // shells dispatch via a case lookup at TAB time.
    function getFieldExpandTable(): {
      dependsOn: readonly string[];
      table: readonly {
        key: readonly string[];
        candidates: readonly { value: string; description?: string }[];
      }[];
    } {
      const data = extractCompletionData(mainCommand, "tailor-sdk");
      const apiCmd = data.command.subcommands.find((s) => s.name === "api");
      if (!apiCmd) throw new Error("api subcommand missing");
      const fieldOpt = apiCmd.options.find((o) => o.name === "field");
      if (!fieldOpt) throw new Error("--field option missing");
      const vc = fieldOpt.valueCompletion;
      if (!vc || vc.type !== "expand") {
        throw new Error(`expected expand completion, got ${vc?.type}`);
      }
      return { dependsOn: vc.dependsOn, table: vc.table };
    }

    function candidatesFor(endpoint: string): readonly { value: string; description?: string }[] {
      const { table } = getFieldExpandTable();
      const row = table.find((r) => r.key[0] === endpoint);
      if (!row) throw new Error(`no expand row for ${endpoint}`);
      return row.candidates;
    }

    test("depends on the endpoint positional", () => {
      const { dependsOn } = getFieldExpandTable();
      expect(dependsOn).toEqual(["endpoint"]);
    });

    test("enumerates top-level fields for the endpoint's proto schema", () => {
      const values = candidatesFor("GetFunctionExecution").map((c) => c.value);
      expect(values).toContain("workspaceId=");
      expect(values).toContain("executionId=");
    });

    test("keys the expand table for the fully-qualified endpoint form too", () => {
      // `api` accepts both `GetApplication` and
      // `tailor.v1.OperatorService/GetApplication`. politty's expand keys the
      // static table by the literal `endpoint` value, so a row keyed by the
      // bare name does not match when the user types the FQ form. Both forms
      // must be present.
      const values = candidatesFor("tailor.v1.OperatorService/GetFunctionExecution").map(
        (c) => c.value,
      );
      expect(values).toContain("workspaceId=");
      expect(values).toContain("executionId=");
    });

    test("enumerates enum values inline alongside the key", () => {
      const values = candidatesFor("ListWorkspaces").map((c) => c.value);
      expect(values).toContain("pageDirection=");
      expect(values).toContain("pageDirection=PAGE_DIRECTION_UNSPECIFIED");
      expect(values).toContain("pageDirection=PAGE_DIRECTION_ASC");
      expect(values).toContain("pageDirection=PAGE_DIRECTION_DESC");
    });

    test("enumerates true/false inline for bool-typed fields", () => {
      const values = candidatesFor("CreateWorkspace").map((c) => c.value);
      expect(values).toContain("deleteProtection=");
      expect(values).toContain("deleteProtection=true");
      expect(values).toContain("deleteProtection=false");
    });

    test("bakes the expand table and dedup tracker into the generated shell script", () => {
      // The whole point of `expand` is that candidates are inlined into the
      // static script — no Node process is spawned per TAB. politty's shell
      // generator additionally populates `_used_field_keys` from already-typed
      // `key=value` args so the same key isn't offered twice when --field is
      // repeated. Confirm both are wired up in the zsh script.
      const { script } = generateCompletion(mainCommand, {
        shell: "zsh",
        programName: "tailor-sdk",
      });
      expect(script).toMatch(/__tailor_sdk_expand_[a-z_]+__field=/);
      expect(script).toContain("GetFunctionExecution");
      expect(script).toContain("_used_field_keys");
    });
  });
});
