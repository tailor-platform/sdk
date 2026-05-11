import fs from "node:fs";
import path from "node:path";
import type { SolveArtifact, SolveResult } from "./solver/types";

const snapshotExcludeNames = new Set([".git", ".sdk", "node_modules"]);

export function persistSolveAttemptArtifact(options: {
  rootDir: string;
  attemptName: string;
  result: SolveResult;
  workDir: string;
}): SolveArtifact {
  const { rootDir, attemptName, result, workDir } = options;
  const artifactDir = path.join(rootDir, attemptName);
  const workSnapshotDir = path.join(artifactDir, "work");
  fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });

  const promptPath = path.join(artifactDir, "prompt.md");
  const stdoutPath = path.join(artifactDir, "stdout.log");
  const stderrPath = path.join(artifactDir, "stderr.log");
  const resultPath = path.join(artifactDir, "result.json");

  fs.writeFileSync(promptPath, result.rawTranscript?.prompt ?? "");
  fs.writeFileSync(stdoutPath, result.rawTranscript?.stdout ?? "");
  fs.writeFileSync(stderrPath, result.rawTranscript?.stderr ?? "");
  copyWorkSnapshot(workDir, workSnapshotDir);

  const artifact: SolveArtifact = {
    directory: artifactDir,
    promptPath,
    stdoutPath,
    stderrPath,
    resultPath,
    workSnapshotDir,
  };
  result.artifact = artifact;
  delete result.rawTranscript;
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  return artifact;
}

export function persistFinalWorkSnapshot(options: { rootDir: string; workDir: string }): string {
  const snapshotDir = path.join(options.rootDir, "final-work");
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  copyWorkSnapshot(options.workDir, snapshotDir);
  return snapshotDir;
}

function copyWorkSnapshot(sourceDir: string, targetDir: string): void {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of entries) {
    if (snapshotExcludeNames.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyWorkSnapshot(sourcePath, targetPath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}
