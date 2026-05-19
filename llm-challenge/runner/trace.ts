import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireArg } from "../shared/helpers";

const challengeRoot = path.resolve(import.meta.dirname, "..");

export type WriteEntry = {
  ts: string;
  toolUseId: string;
  contentLength: number;
  isFalseStart: boolean;
  diffSummary?: {
    addedLines: number;
    removedLines: number;
    firstDifference: string;
  };
};

export type FileTrace = {
  filePath: string;
  writes: WriteEntry[];
  falseStartCount: number;
};

export type EditEntry = {
  ts: string;
  filePath: string;
  oldStringLength: number;
  newStringLength: number;
};

export type BashEntry = {
  ts: string;
  command: string;
  description?: string;
};

export type ReadEntry = {
  ts: string;
  filePath: string;
};

export type ParsedTrace = {
  durationMs: number;
  files: FileTrace[];
  edits: EditEntry[];
  bashCommands: BashEntry[];
  readPaths: ReadEntry[];
  assistantTextLength: number;
  falseStartTotal: number;
};

export type Trace = ParsedTrace & {
  workDir: string;
  jsonlPath: string;
  sessionId: string;
  problemId?: string;
};

const MAX_FIRST_DIFFERENCE_LEN = 200;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeFilePath(filePath: string, workDirRealPath?: string): string {
  if (!workDirRealPath) {
    return filePath;
  }
  const trimmed = workDirRealPath.endsWith("/") ? workDirRealPath.slice(0, -1) : workDirRealPath;
  if (filePath === trimmed) {
    return ".";
  }
  if (filePath.startsWith(`${trimmed}/`)) {
    return filePath.slice(trimmed.length + 1);
  }
  return filePath;
}

function summarizeDiff(prev: string, next: string): WriteEntry["diffSummary"] {
  const prevLines = prev.split("\n");
  const nextLines = next.split("\n");
  const maxLen = Math.max(prevLines.length, nextLines.length);
  let firstDiffIdx = -1;
  for (let i = 0; i < maxLen; i++) {
    if (prevLines[i] !== nextLines[i]) {
      firstDiffIdx = i;
      break;
    }
  }
  const addedLines = Math.max(0, nextLines.length - prevLines.length);
  const removedLines = Math.max(0, prevLines.length - nextLines.length);
  let firstDifference = "";
  if (firstDiffIdx >= 0) {
    const before = prevLines[firstDiffIdx] ?? "";
    const after = nextLines[firstDiffIdx] ?? "";
    firstDifference = `line ${firstDiffIdx + 1}: ${before} -> ${after}`;
    if (firstDifference.length > MAX_FIRST_DIFFERENCE_LEN) {
      firstDifference = `${firstDifference.slice(0, MAX_FIRST_DIFFERENCE_LEN - 1)}…`;
    }
  }
  return { addedLines, removedLines, firstDifference };
}

type WriteAttempt = { ts: string; id: string; content: string };

export function parseTrace(input: { lines: string[]; workDirRealPath?: string }): ParsedTrace {
  const { lines, workDirRealPath } = input;
  const writesByFile = new Map<string, WriteAttempt[]>();
  const edits: EditEntry[] = [];
  const bashCommands: BashEntry[] = [];
  const readPaths: ReadEntry[] = [];
  let assistantTextLength = 0;

  const errored = new Set<string>();

  let firstTs: string | undefined;
  let lastTs: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }
    const type = obj.type;

    if (type === "assistant") {
      const message = asRecord(obj.message);
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        const itemObj = asRecord(item);
        if (!itemObj) continue;
        const itemType = itemObj.type;
        if (itemType === "text" && typeof itemObj.text === "string") {
          assistantTextLength += itemObj.text.length;
          continue;
        }
        if (itemType !== "tool_use") continue;
        const id = typeof itemObj.id === "string" ? itemObj.id : "";
        const name = typeof itemObj.name === "string" ? itemObj.name : "";
        const itemInput = asRecord(itemObj.input) ?? {};
        if (!id || !name) continue;

        if (name === "Write") {
          const filePath = typeof itemInput.file_path === "string" ? itemInput.file_path : "";
          const contentStr = typeof itemInput.content === "string" ? itemInput.content : "";
          if (!filePath) continue;
          const bucket = writesByFile.get(filePath) ?? [];
          bucket.push({ ts, id, content: contentStr });
          writesByFile.set(filePath, bucket);
        } else if (name === "Edit" || name === "MultiEdit") {
          const filePath = typeof itemInput.file_path === "string" ? itemInput.file_path : "";
          const oldStr = typeof itemInput.old_string === "string" ? itemInput.old_string : "";
          const newStr = typeof itemInput.new_string === "string" ? itemInput.new_string : "";
          if (filePath) {
            edits.push({
              ts,
              filePath: normalizeFilePath(filePath, workDirRealPath),
              oldStringLength: oldStr.length,
              newStringLength: newStr.length,
            });
          }
        } else if (name === "Bash") {
          const command = typeof itemInput.command === "string" ? itemInput.command : "";
          const description =
            typeof itemInput.description === "string" ? itemInput.description : undefined;
          if (command) {
            const bash: BashEntry = { ts, command };
            if (description) bash.description = description;
            bashCommands.push(bash);
          }
        } else if (name === "Read") {
          const filePath = typeof itemInput.file_path === "string" ? itemInput.file_path : "";
          if (filePath) {
            readPaths.push({ ts, filePath: normalizeFilePath(filePath, workDirRealPath) });
          }
        }
      }
      continue;
    }

    if (type === "user") {
      const message = asRecord(obj.message);
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        const itemObj = asRecord(item);
        if (!itemObj || itemObj.type !== "tool_result") continue;
        const id = typeof itemObj.tool_use_id === "string" ? itemObj.tool_use_id : "";
        if (id && itemObj.is_error === true) {
          errored.add(id);
        }
      }
    }
  }

  // Build per-file write trace, dropping errored writes
  const files: FileTrace[] = [];
  for (const [filePath, attempts] of writesByFile.entries()) {
    const successful = attempts.filter((a) => !errored.has(a.id));
    if (successful.length === 0) continue;
    const writes: WriteEntry[] = successful.map((entry, idx) => {
      const isFalseStart = idx < successful.length - 1;
      const w: WriteEntry = {
        ts: entry.ts,
        toolUseId: entry.id,
        contentLength: entry.content.length,
        isFalseStart,
      };
      if (isFalseStart) {
        const next = successful[idx + 1]!;
        w.diffSummary = summarizeDiff(entry.content, next.content);
      }
      return w;
    });
    files.push({
      filePath: normalizeFilePath(filePath, workDirRealPath),
      writes,
      falseStartCount: writes.filter((w) => w.isFalseStart).length,
    });
  }
  files.sort((a, b) => a.filePath.localeCompare(b.filePath));

  const falseStartTotal = files.reduce((acc, f) => acc + f.falseStartCount, 0);
  const durationMs =
    firstTs && lastTs ? Math.max(0, new Date(lastTs).getTime() - new Date(firstTs).getTime()) : 0;

  return {
    durationMs,
    files,
    edits,
    bashCommands,
    readPaths,
    assistantTextLength,
    falseStartTotal,
  };
}

function encodeWorkDirToProjectDirName(realWorkDir: string): string {
  return realWorkDir.replaceAll("/", "-");
}

function findJsonl(workDir: string, sessionId?: string): { path: string; sessionId: string } {
  const real = fs.realpathSync(workDir);
  const encoded = encodeWorkDirToProjectDirName(real);
  const projectDir = path.join(os.homedir(), ".claude", "projects", encoded);
  if (!fs.existsSync(projectDir)) {
    throw new Error(`No Claude session directory found: ${projectDir}`);
  }
  const candidates = fs
    .readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ name: f, full: path.join(projectDir, f) }));
  if (candidates.length === 0) {
    throw new Error(`No JSONL session file under ${projectDir}`);
  }
  if (sessionId) {
    const match = candidates.find(
      (c) => c.name === `${sessionId}.jsonl` || c.name.startsWith(`${sessionId}`),
    );
    if (!match) {
      throw new Error(`Session ${sessionId} not found in ${projectDir}`);
    }
    return { path: match.full, sessionId: match.name.replace(/\.jsonl$/, "") };
  }
  const sorted = candidates
    .map((c) => ({ ...c, mtime: fs.statSync(c.full).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const latest = sorted[0]!;
  return { path: latest.full, sessionId: latest.name.replace(/\.jsonl$/, "") };
}

function parseArgs(): {
  workDir: string;
  session?: string;
  problem?: string;
  out?: string;
} {
  const args = process.argv.slice(2);
  let workDir: string | undefined;
  let session: string | undefined;
  let problem: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--workdir":
        workDir = requireArg(args, i, "--workdir");
        i++;
        break;
      case "--session":
        session = requireArg(args, i, "--session");
        i++;
        break;
      case "--problem":
        problem = requireArg(args, i, "--problem");
        i++;
        break;
      case "--out":
        out = requireArg(args, i, "--out");
        i++;
        break;
    }
  }
  if (!workDir) {
    console.error(
      "Usage: tsx runner/trace.ts --workdir <dir> [--session <uuid>] [--problem <id>] [--out <path>]",
    );
    process.exit(1);
  }
  return { workDir, session, problem, out };
}

function main(): void {
  const { workDir, session, problem, out } = parseArgs();
  const absWorkDir = path.resolve(workDir);
  const { path: jsonlPath, sessionId } = findJsonl(absWorkDir, session);

  const lines = fs.readFileSync(jsonlPath, "utf-8").split("\n");
  const real = fs.realpathSync(absWorkDir);
  const parsed = parseTrace({ lines, workDirRealPath: real });

  const trace: Trace = {
    workDir: absWorkDir,
    jsonlPath,
    sessionId,
    ...(problem ? { problemId: problem } : {}),
    ...parsed,
  };

  const resultsDir = path.join(challengeRoot, "results");
  const label = problem ?? path.basename(absWorkDir);
  const ts = new Date().toISOString().replace(/:/g, "-").slice(0, 19);
  const outPath = out ?? path.join(resultsDir, `trace-${label}-${ts}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(trace, null, 2));

  console.log("");
  console.log(`Trace written: ${outPath}`);
  console.log(`Session:       ${sessionId}`);
  console.log(`Duration:      ${(parsed.durationMs / 1000).toFixed(1)}s`);
  console.log(`False starts:  ${parsed.falseStartTotal}`);
  console.log(`Files:         ${parsed.files.length}`);
  console.log(`Edits:         ${parsed.edits.length}`);
  console.log(`Reads:         ${parsed.readPaths.length}`);
  console.log(`Bash:          ${parsed.bashCommands.length}`);
}

const isCliEntry =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("trace.ts") ||
  process.argv[1]?.endsWith("trace.js");
if (isCliEntry) {
  main();
}
