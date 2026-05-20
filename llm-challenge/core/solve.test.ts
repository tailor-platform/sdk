import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPrompt } from "./solve";

describe("buildPrompt", () => {
  const tmpDirs: string[] = [];

  function makeFixture(opts: {
    problem: string;
    scaffoldFiles: Record<string, string>;
    implement: string[];
  }): { problemDir: string; workDir: string; meta: Parameters<typeof buildPrompt>[1] } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llm-buildprompt-"));
    tmpDirs.push(root);
    const problemDir = path.join(root, "problem");
    const workDir = path.join(root, "work");
    const solutionDir = path.join(problemDir, "solution");
    fs.mkdirSync(problemDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(solutionDir, { recursive: true });
    fs.writeFileSync(path.join(problemDir, "problem.md"), opts.problem);
    for (const [rel, body] of Object.entries(opts.scaffoldFiles)) {
      const full = path.join(workDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    for (const rel of opts.implement) {
      const full = path.join(solutionDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "// solution\n");
    }
    const meta = {
      id: "999",
      sdkSurface: "api-design",
    } as Parameters<typeof buildPrompt>[1];
    return { problemDir, workDir, meta };
  }

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses implement mode when no scaffold overlaps the implement files", () => {
    const { problemDir, workDir, meta } = makeFixture({
      problem: "Build the thing.",
      scaffoldFiles: { "package.json": "{}\n" },
      implement: ["resolvers/a.ts"],
    });

    const prompt = buildPrompt(problemDir, meta, workDir, "full-package");

    // System block describes "create" mode.
    expect(prompt).toContain(
      "Create ONLY the files listed in the task. Do NOT modify existing files.",
    );
    // Must NOT include fix-mode phrasing.
    expect(prompt).not.toContain("Fix the issues in the listed files");
    expect(prompt).not.toContain("Some files already exist and need to be fixed");
    // Single "Files to Create" group, no "Files to Fix" group.
    expect(prompt).toContain("## Files to Create");
    expect(prompt).not.toContain("## Files to Fix");
    expect(prompt).toContain("- resolvers/a.ts");
    // Problem body is included.
    expect(prompt).toContain("Build the thing.");
  });

  it("uses fix mode when every implement file already exists in scaffold", () => {
    const { problemDir, workDir, meta } = makeFixture({
      problem: "Fix the broken resolver.",
      scaffoldFiles: { "resolvers/a.ts": "// broken\n" },
      implement: ["resolvers/a.ts"],
    });

    const prompt = buildPrompt(problemDir, meta, workDir, "full-package");

    // System block describes "fix" mode.
    expect(prompt).toContain(
      "Fix the issues in the listed files. Read the existing files first, then modify them.",
    );
    // Must NOT include implement-only or hybrid phrasings.
    expect(prompt).not.toContain("Create ONLY the files listed in the task");
    expect(prompt).not.toContain("Some files already exist and need to be fixed");
    // Single "Files to Fix" group, no "Files to Create" group.
    expect(prompt).toContain("## Files to Fix");
    expect(prompt).not.toContain("## Files to Create");
    expect(prompt).toContain("- resolvers/a.ts");
  });

  it("uses hybrid mode when implement has both pre-existing and new files", () => {
    const { problemDir, workDir, meta } = makeFixture({
      problem: "Fix one resolver and add another.",
      scaffoldFiles: { "resolvers/a.ts": "// broken\n" },
      implement: ["resolvers/a.ts", "resolvers/b.ts"],
    });

    const prompt = buildPrompt(problemDir, meta, workDir, "full-package");

    // System block describes hybrid mode.
    expect(prompt).toContain(
      "Some files already exist and need to be fixed; other files must be created from scratch.",
    );
    expect(prompt).toContain('For "Files to Fix": read and modify existing files.');
    expect(prompt).toContain('For "Files to Create": create new files.');
    // Must NOT include pure-implement or pure-fix phrasings.
    expect(prompt).not.toContain("Create ONLY the files listed in the task");
    expect(prompt).not.toContain(
      "Fix the issues in the listed files. Read the existing files first, then modify them.",
    );
    // Two distinct sections.
    expect(prompt).toContain("## Files to Fix");
    expect(prompt).toContain("## Files to Create");
    // Each file appears in exactly one group.
    const fixIdx = prompt.indexOf("## Files to Fix");
    const createIdx = prompt.indexOf("## Files to Create");
    expect(fixIdx).toBeLessThan(createIdx);
    const fixSection = prompt.slice(fixIdx, createIdx);
    const createSection = prompt.slice(createIdx);
    expect(fixSection).toContain("- resolvers/a.ts");
    expect(fixSection).not.toContain("- resolvers/b.ts");
    expect(createSection).toContain("- resolvers/b.ts");
    expect(createSection).not.toContain("- resolvers/a.ts");
  });
});
