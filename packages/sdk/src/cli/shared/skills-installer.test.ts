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
    //   skills/tailor-sdk-overview/SKILL.md
    //   skills/tailor-sdk-plugin/SKILL.md
    //   skills/tailor-sdk-auth/SKILL.md
    //   skills/_artifacts/spec.md     (should be excluded)
    fs.mkdirSync(path.join(skillsSourceDir, "tailor-sdk-overview"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(skillsSourceDir, "tailor-sdk-overview", "SKILL.md"), "# Overview");

    fs.mkdirSync(path.join(skillsSourceDir, "tailor-sdk-plugin"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(skillsSourceDir, "tailor-sdk-plugin", "SKILL.md"), "# Plugin");

    fs.mkdirSync(path.join(skillsSourceDir, "tailor-sdk-auth"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(skillsSourceDir, "tailor-sdk-auth", "SKILL.md"), "# Auth");

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
    it("copies files to both .claude/ and .agents/ skill directories", () => {
      const projectDir = path.join(tmpDir, "project");
      fs.mkdirSync(projectDir);

      const result = copySkills({ projectDir, sourceDir: skillsSourceDir });

      expect(result.destinationDirs).toEqual([
        path.join(projectDir, ".claude/skills"),
        path.join(projectDir, ".agents/skills"),
      ]);
      expect(result.copiedFiles).toContain("tailor-sdk-overview/SKILL.md");
      expect(result.copiedFiles).toContain("tailor-sdk-plugin/SKILL.md");
      expect(result.copiedFiles).toContain("tailor-sdk-auth/SKILL.md");

      // Verify files exist in both destinations
      for (const dir of [".claude/skills", ".agents/skills"]) {
        expect(fs.existsSync(path.join(projectDir, dir, "tailor-sdk-overview/SKILL.md"))).toBe(
          true,
        );
        expect(fs.existsSync(path.join(projectDir, dir, "tailor-sdk-plugin/SKILL.md"))).toBe(true);
        expect(fs.existsSync(path.join(projectDir, dir, "tailor-sdk-auth/SKILL.md"))).toBe(true);
      }
    });

    it("excludes _artifacts/ directory", () => {
      const projectDir = path.join(tmpDir, "project");
      fs.mkdirSync(projectDir);

      const result = copySkills({ projectDir, sourceDir: skillsSourceDir });

      expect(result.copiedFiles).not.toContain("_artifacts/spec.md");
      expect(fs.existsSync(path.join(projectDir, ".claude/skills/_artifacts/spec.md"))).toBe(false);
      expect(fs.existsSync(path.join(projectDir, ".agents/skills/_artifacts/spec.md"))).toBe(false);
    });

    it("removes stale files from previous versions", () => {
      const projectDir = path.join(tmpDir, "project");

      // Simulate a stale SDK skill and a non-SDK skill
      for (const dir of [".claude/skills", ".agents/skills"]) {
        const staleFile = path.join(projectDir, dir, "tailor-sdk-old-skill/SKILL.md");
        fs.mkdirSync(path.dirname(staleFile), { recursive: true });
        fs.writeFileSync(staleFile, "stale");

        const otherFile = path.join(projectDir, dir, "other-skill/SKILL.md");
        fs.mkdirSync(path.dirname(otherFile), { recursive: true });
        fs.writeFileSync(otherFile, "keep me");
      }

      copySkills({ projectDir, sourceDir: skillsSourceDir });

      // Stale SDK skills should be gone
      expect(
        fs.existsSync(path.join(projectDir, ".claude/skills/tailor-sdk-old-skill/SKILL.md")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(projectDir, ".agents/skills/tailor-sdk-old-skill/SKILL.md")),
      ).toBe(false);

      // Non-SDK skills should be preserved
      expect(fs.existsSync(path.join(projectDir, ".claude/skills/other-skill/SKILL.md"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(projectDir, ".agents/skills/other-skill/SKILL.md"))).toBe(
        true,
      );

      // New files should exist
      expect(
        fs.existsSync(path.join(projectDir, ".claude/skills/tailor-sdk-overview/SKILL.md")),
      ).toBe(true);
    });

    it("overwrites existing files", () => {
      const projectDir = path.join(tmpDir, "project");
      const destFile = path.join(projectDir, ".claude/skills/tailor-sdk-overview/SKILL.md");
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.writeFileSync(destFile, "old content");

      const result = copySkills({ projectDir, sourceDir: skillsSourceDir });

      expect(result.copiedFiles).toContain("tailor-sdk-overview/SKILL.md");
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

      const code = await runSkillsInstaller({
        sourceDir: skillsSourceDir,
        projectDir,
      });
      expect(code).toBe(0);

      expect(
        fs.existsSync(path.join(projectDir, ".claude/skills/tailor-sdk-overview/SKILL.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectDir, ".agents/skills/tailor-sdk-overview/SKILL.md")),
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
