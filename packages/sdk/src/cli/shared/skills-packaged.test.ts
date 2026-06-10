import { readFileSync, readdirSync, statSync } from "node:fs";
import { parseYAML } from "confbox";
import { resolve } from "pathe";
import { describe, expect, test } from "vitest";

const sdkRoot = resolve(import.meta.dirname, "..", "..", "..");
const skillsRoot = resolve(sdkRoot, "agent-skills");

const NODE_MODULES_REF_PATTERN = /node_modules\/@tailor-platform\/sdk\/([^\s`)]+)/g;

function listSkillDirs(): string[] {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function extractFrontmatter(content: string): Record<string, unknown> | null {
  const match = /^---\n([\s\S]+?)\n---/.exec(content);
  if (!match) return null;
  const parsed = parseYAML(match[1]!);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
}

function stripTrailingGlob(relPath: string): string {
  return relPath.replace(/\/\*\*?[^/]*$/, "");
}

describe("packaged skills", () => {
  const skillDirs = listSkillDirs();

  test("has at least one shipped skill directory", () => {
    expect(skillDirs.length).toBeGreaterThan(0);
  });

  describe.each(skillDirs)("%s", (name) => {
    const skillMd = resolve(skillsRoot, name, "SKILL.md");
    const content = readFileSync(skillMd, "utf8");

    test("has SKILL.md frontmatter with matching name and non-empty description", () => {
      const frontmatter = extractFrontmatter(content);
      expect(frontmatter, `missing --- frontmatter in ${skillMd}`).not.toBeNull();
      expect(frontmatter?.name).toBe(name);
      expect(typeof frontmatter?.description).toBe("string");
      expect((frontmatter?.description as string).trim().length).toBeGreaterThan(0);
    });

    test("references existing SDK files for every node_modules/@tailor-platform/sdk path", () => {
      const matches = [...content.matchAll(NODE_MODULES_REF_PATTERN)];
      expect(matches.length, "skill should reference at least one SDK asset").toBeGreaterThan(0);
      for (const match of matches) {
        const rawPath = match[1]!;
        const abs = resolve(sdkRoot, stripTrailingGlob(rawPath));
        expect(
          () => statSync(abs),
          `missing SDK asset referenced by skill: ${rawPath}`,
        ).not.toThrow();
      }
    });
  });
});
