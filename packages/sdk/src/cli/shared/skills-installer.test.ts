import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SKILL_NAME,
  copySkills,
  resolveSkillsSourceDir,
  runSkillsInstaller,
} from "./skills-installer";

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  styles: {
    dim: (text: string) => text,
  },
}));

describe("skills-installer", () => {
  let tmpDir: string;
  let skillsSourceDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? ".", "skills-test-"));
    skillsSourceDir = path.join(tmpDir, "source-skills");

    // Create a fake skills source tree matching the real layout:
    //   skills/overview/SKILL.md
    //   skills/plugin/SKILL.md
    //   skills/services/auth/SKILL.md
    //   skills/_artifacts/spec.md     (should be excluded)
    fs.mkdirSync(path.join(skillsSourceDir, "overview"), { recursive: true });
    fs.writeFileSync(path.join(skillsSourceDir, "overview", "SKILL.md"), "# Overview");

    fs.mkdirSync(path.join(skillsSourceDir, "plugin"), { recursive: true });
    fs.writeFileSync(path.join(skillsSourceDir, "plugin", "SKILL.md"), "# Plugin");

    fs.mkdirSync(path.join(skillsSourceDir, "services", "auth"), { recursive: true });
    fs.writeFileSync(path.join(skillsSourceDir, "services", "auth", "SKILL.md"), "# Auth");

    fs.mkdirSync(path.join(skillsSourceDir, "_artifacts"), { recursive: true });
    fs.writeFileSync(path.join(skillsSourceDir, "_artifacts", "spec.md"), "artifact");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolveSkillsSourceDir", () => {
    it("returns a path ending with /skills", () => {
      const dir = resolveSkillsSourceDir();
      expect(dir).toMatch(/\/skills$/);
    });
  });

  describe("copySkills", () => {
    it("copies files to .claude/skills/tailor-sdk/ preserving structure", () => {
      const projectDir = path.join(tmpDir, "project");
      fs.mkdirSync(projectDir);

      const result = copySkills({ projectDir, sourceDir: skillsSourceDir });

      expect(result.destinationDir).toBe(path.join(projectDir, ".claude/skills/tailor-sdk"));
      expect(result.copiedFiles).toContain("overview/SKILL.md");
      expect(result.copiedFiles).toContain("plugin/SKILL.md");
      expect(result.copiedFiles).toContain("services/auth/SKILL.md");

      // Verify files exist on disk
      expect(
        fs.existsSync(path.join(projectDir, ".claude/skills/tailor-sdk/overview/SKILL.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, ".claude/skills/tailor-sdk/plugin/SKILL.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, ".claude/skills/tailor-sdk/services/auth/SKILL.md")),
      ).toBe(true);
    });

    it("excludes _artifacts/ directory", () => {
      const projectDir = path.join(tmpDir, "project");
      fs.mkdirSync(projectDir);

      const result = copySkills({ projectDir, sourceDir: skillsSourceDir });

      expect(result.copiedFiles).not.toContain("_artifacts/spec.md");
      expect(
        fs.existsSync(path.join(projectDir, ".claude/skills/tailor-sdk/_artifacts/spec.md")),
      ).toBe(false);
    });

    it("overwrites existing files", () => {
      const projectDir = path.join(tmpDir, "project");
      const destFile = path.join(projectDir, ".claude/skills/tailor-sdk/overview/SKILL.md");
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.writeFileSync(destFile, "old content");

      const result = copySkills({ projectDir, sourceDir: skillsSourceDir });

      expect(result.copiedFiles).toContain("overview/SKILL.md");
      expect(fs.readFileSync(destFile, "utf8")).toBe("# Overview");
    });

    it("throws when skills source directory does not exist", () => {
      expect(() => copySkills({ sourceDir: path.join(tmpDir, "nonexistent") })).toThrow(
        "Skills directory not found",
      );
    });
  });

  describe("runSkillsInstaller", () => {
    it("returns 0 on success", async () => {
      const projectDir = path.join(tmpDir, "project-run");
      fs.mkdirSync(projectDir);

      const code = await runSkillsInstaller({ sourceDir: skillsSourceDir, projectDir });
      expect(code).toBe(0);

      expect(
        fs.existsSync(path.join(projectDir, ".claude/skills/tailor-sdk/overview/SKILL.md")),
      ).toBe(true);
    });

    it("returns 1 on failure", async () => {
      const code = await runSkillsInstaller({
        sourceDir: path.join(tmpDir, "nonexistent"),
        projectDir: path.join(tmpDir, "project-fail"),
      });
      expect(code).toBe(1);
    });
  });

  describe("SKILL_NAME", () => {
    it("exports the skill name constant", () => {
      expect(SKILL_NAME).toBe("tailor-sdk");
    });
  });
});
