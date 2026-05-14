import fs from "node:fs";
import path from "node:path";
import type { ProblemResult } from "./report";

export type CheckpointEntry = {
  problemName: string;
  iter: number;
  result: ProblemResult;
};

export function checkpointPath(runResultsDir: string, runId: string): string {
  return path.join(runResultsDir, `checkpoint-${runId}.jsonl`);
}

export function appendCheckpoint(checkpointFile: string, entry: CheckpointEntry): void {
  fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
  fs.appendFileSync(checkpointFile, `${JSON.stringify(entry)}\n`);
}

/**
 * Read all checkpoint entries from a JSONL file. Malformed last lines
 * (from a write interrupted mid-flush) are silently dropped — the runner
 * will re-execute the iteration. Missing files return [].
 */
export function readCheckpoint(checkpointFile: string): CheckpointEntry[] {
  if (!fs.existsSync(checkpointFile)) return [];
  const raw = fs.readFileSync(checkpointFile, "utf-8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const entries: CheckpointEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as CheckpointEntry);
    } catch {
      // tolerate malformed last line from an interrupted write
    }
  }
  return entries;
}

export function deleteCheckpoint(checkpointFile: string): void {
  try {
    fs.rmSync(checkpointFile, { force: true });
  } catch {
    // best effort
  }
}

/**
 * Group entries by problem name, then by iteration index. The latest entry
 * for a given (problem, iter) pair wins, so a successful retry overwrites an
 * earlier infra-failure record.
 */
export function groupCheckpoint(
  entries: CheckpointEntry[],
): Map<string, Map<number, ProblemResult>> {
  const map = new Map<string, Map<number, ProblemResult>>();
  for (const e of entries) {
    let inner = map.get(e.problemName);
    if (!inner) {
      inner = new Map();
      map.set(e.problemName, inner);
    }
    inner.set(e.iter, e.result);
  }
  return map;
}

/**
 * Return true when a saved iteration result is "good enough" to reuse on
 * resume — i.e. not an infra failure. infra-failure results (rate-limit,
 * auth, container) should be re-attempted; everything else (real pass /
 * real verification fail) is deterministic and can be carried over.
 */
export function isCheckpointReusable(result: ProblemResult): boolean {
  return result.solveResult?.infraFailure !== true;
}
