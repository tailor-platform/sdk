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
    it("completes root subcommands", () => {
      const ctx = parseCompletionContext([""], mainCommand);
      const result = generateCandidates(ctx);

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("apply");
      expect(values).toContain("generate");
      expect(values).toContain("tailordb");
      expect(values).toContain("workspace");
      expect(values).toContain("completion");
    });

    it("completes nested subcommands for tailordb", () => {
      const ctx = parseCompletionContext(["tailordb", ""], mainCommand);
      const result = generateCandidates(ctx);

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("erd");
      expect(values).toContain("migration");
      expect(values).toContain("truncate");
    });
  });

  describe("option name completion", () => {
    it("completes option names for apply command", () => {
      const ctx = parseCompletionContext(["apply", "--"], mainCommand);
      const result = generateCandidates(ctx);

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("--config");
      expect(values).toContain("--workspace-id");
      expect(values).toContain("--profile");
      expect(values).toContain("--yes");
    });

    it("completes option names for workspace create command", () => {
      const ctx = parseCompletionContext(["workspace", "create", "--"], mainCommand);
      const result = generateCandidates(ctx);

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("--name");
      expect(values).toContain("--region");
      expect(values).toContain("--delete-protection");
    });
  });

  describe("file completion", () => {
    it("triggers file completion with extension filter for --config", () => {
      const ctx = parseCompletionContext(["apply", "--config", ""], mainCommand);
      const result = generateCandidates(ctx);

      // With extensions set, politty uses @ext: metadata instead of FileCompletion directive
      expect(result.fileExtensions).toEqual(["ts"]);
    });

    // --env-file and --env-file-if-exists are global args (via runMain's globalArgs),
    // so they are not visible through the low-level parseCompletionContext API.
  });

  describe("directory completion", () => {
    it("triggers directory completion for staticwebsite deploy --dir", () => {
      const ctx = parseCompletionContext(["staticwebsite", "deploy", "--dir", ""], mainCommand);
      const result = generateCandidates(ctx);

      expect(result.directive & CompletionDirective.DirectoryCompletion).toBeTruthy();
    });

    it("triggers directory completion for tailordb erd export --output", () => {
      const ctx = parseCompletionContext(
        ["tailordb", "erd", "export", "--output", ""],
        mainCommand,
      );
      const result = generateCandidates(ctx);

      expect(result.directive & CompletionDirective.DirectoryCompletion).toBeTruthy();
    });
  });

  describe("no file completion", () => {
    it("suppresses file completion for --workspace-id", () => {
      const ctx = parseCompletionContext(["apply", "--workspace-id", ""], mainCommand);
      const result = generateCandidates(ctx);

      expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
    });

    it("suppresses file completion for --profile", () => {
      const ctx = parseCompletionContext(["apply", "--profile", ""], mainCommand);
      const result = generateCandidates(ctx);

      expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
    });
  });

  describe("enum completion", () => {
    it("completes role values for workspace user invite", () => {
      const ctx = parseCompletionContext(
        ["workspace", "user", "invite", "--role", ""],
        mainCommand,
      );
      const result = generateCandidates(ctx);

      const values = result.candidates.map((c) => c.value);
      expect(values).toContain("admin");
      expect(values).toContain("editor");
      expect(values).toContain("viewer");
      expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
    });
  });
});
