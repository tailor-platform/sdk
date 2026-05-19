import {
  CompletionDirective,
  generateCandidates,
  parseCompletionContext,
} from "politty/completion";
import { describe, expect, it, vi } from "vitest";
import { mainCommand } from "./index";

vi.mock("node:module", async (importOriginal) => ({
  ...(await importOriginal()),
  register: vi.fn(),
}));

vi.mock("politty", async (importOriginal) => ({
  ...(await importOriginal()),
  runMain: vi.fn(),
}));

describe("shell completion", () => {
  describe("subcommand completion", () => {
    it("completes root subcommands", async () => {
      const ctx = parseCompletionContext([""], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("deploy");
      expect(values).toContain("generate");
      expect(values).toContain("tailordb");
      expect(values).toContain("workspace");
      expect(values).toContain("completion");
    });

    it("completes nested subcommands for tailordb", async () => {
      const ctx = parseCompletionContext(["tailordb", ""], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("erd");
      expect(values).toContain("migration");
      expect(values).toContain("truncate");
    });
  });

  describe("option name completion", () => {
    it("completes option names for deploy command", async () => {
      const ctx = parseCompletionContext(["deploy", "--"], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("--config");
      expect(values).toContain("--workspace-id");
      expect(values).toContain("--profile");
      expect(values).toContain("--yes");
    });

    it("completes option names for workspace create command", async () => {
      const ctx = parseCompletionContext(["workspace", "create", "--"], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("--name");
      expect(values).toContain("--region");
      expect(values).toContain("--delete-protection");
    });
  });

  describe("file completion", () => {
    it("triggers file completion with extension filter for --config", async () => {
      const ctx = parseCompletionContext(["deploy", "--config", ""], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      // With extensions set, politty uses @ext: metadata instead of FileCompletion directive
      expect(result.fileExtensions).toEqual(["ts"]);
    });

    // --env-file and --env-file-if-exists are global args (via runMain's globalArgs),
    // so they are not visible through the low-level parseCompletionContext API.
  });

  describe("directory completion", () => {
    it("triggers directory completion for staticwebsite deploy --dir", async () => {
      const ctx = parseCompletionContext(["staticwebsite", "deploy", "--dir", ""], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      expect(result.directive & CompletionDirective.DirectoryCompletion).toBeTruthy();
    });

    it("triggers directory completion for tailordb erd export --output", async () => {
      const ctx = parseCompletionContext(
        ["tailordb", "erd", "export", "--output", ""],
        mainCommand,
      );
      const result = await generateCandidates(ctx, { shell: "bash" });

      expect(result.directive & CompletionDirective.DirectoryCompletion).toBeTruthy();
    });
  });

  describe("no file completion", () => {
    it("suppresses file completion for --workspace-id", async () => {
      const ctx = parseCompletionContext(["deploy", "--workspace-id", ""], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
    });

    it("suppresses file completion for --profile", async () => {
      const ctx = parseCompletionContext(["deploy", "--profile", ""], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
    });
  });

  describe("enum completion", () => {
    it("completes role values for workspace user invite", async () => {
      const ctx = parseCompletionContext(
        ["workspace", "user", "invite", "--role", ""],
        mainCommand,
      );
      const result = await generateCandidates(ctx, { shell: "bash" });

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("admin");
      expect(values).toContain("editor");
      expect(values).toContain("viewer");
      expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
    });
  });

  describe("api --field dynamic completion", () => {
    it("returns top-level fields from the endpoint's proto schema", async () => {
      const ctx = parseCompletionContext(["api", "GetFunctionExecution", "-f", ""], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("workspaceId=");
      expect(values).toContain("executionId=");
    });

    it("dedupes keys that were already supplied via previous --field flags", async () => {
      const ctx = parseCompletionContext(
        ["api", "GetFunctionExecution", "-f", "executionId=exec-1", "-f", ""],
        mainCommand,
      );
      const result = await generateCandidates(ctx, { shell: "bash" });

      const values = result.candidates.map((c) => c.value);
      expect(values).not.toContain("executionId=");
      expect(values).toContain("workspaceId=");
    });

    it("returns an empty list when no endpoint has been typed", async () => {
      const ctx = parseCompletionContext(["api", "-f", ""], mainCommand);
      const result = await generateCandidates(ctx, { shell: "bash" });

      expect(result.candidates).toEqual([]);
    });

    it("completes enum values for enum-typed fields", async () => {
      const ctx = parseCompletionContext(
        ["api", "ListWorkspaces", "-f", "pageDirection="],
        mainCommand,
      );
      const result = await generateCandidates(ctx, { shell: "bash" });

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("pageDirection=PAGE_DIRECTION_UNSPECIFIED");
      expect(values).toContain("pageDirection=PAGE_DIRECTION_ASC");
      expect(values).toContain("pageDirection=PAGE_DIRECTION_DESC");
    });

    it("completes true/false for bool-typed fields", async () => {
      const ctx = parseCompletionContext(
        ["api", "CreateWorkspace", "-f", "deleteProtection="],
        mainCommand,
      );
      const result = await generateCandidates(ctx, { shell: "bash" });

      const values = result.candidates.map((c) => c.value);
      expect(values).toEqual(["deleteProtection=true", "deleteProtection=false"]);
    });

    it("returns an empty list for free-form scalar values", async () => {
      const ctx = parseCompletionContext(
        ["api", "GetFunctionExecution", "-f", "executionId="],
        mainCommand,
      );
      const result = await generateCandidates(ctx, { shell: "bash" });

      expect(result.candidates).toEqual([]);
    });

    it("returns an empty list for unknown field keys", async () => {
      const ctx = parseCompletionContext(
        ["api", "GetFunctionExecution", "-f", "nope="],
        mainCommand,
      );
      const result = await generateCandidates(ctx, { shell: "bash" });

      expect(result.candidates).toEqual([]);
    });
  });
});
