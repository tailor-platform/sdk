import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { StageResult } from "./report";
import { parseClaudeJsonOutput } from "./solver/claude";
import type { TraceEvent } from "./trace";

/**
 * Pinned Claude Haiku model id used by every judge call. We hard-code the
 * version suffix so judge outputs remain comparable across runs even when the
 * upstream alias drifts (per plan section "A. LLM-as-judge の決定性").
 */
export const JUDGE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Seed vocabulary surfaced in the prompt as label suggestions. Free-form
 * outputs are still accepted, but seeding keeps early-run labels diff-able
 * against the old 12-affordance taxonomy.
 */
export const SEED_AFFORDANCE_LABELS: readonly string[] = [
  "consolidation_candidate",
  "naming_bias",
  "context_bloat",
  "missing_namespace",
  "param_confusion",
  "missing_action_verb",
  "type_too_loose",
  "type_too_strict",
  "redundant_call_pattern",
  "implicit_assumption",
  "error_message_opaque",
  "docs_only",
];

const MAX_TRACE_EVENTS_IN_PROMPT = 50;
const MAX_FAILED_TEST_CHARS = 3000;
const MAX_DIFF_CHARS = 8000;
const MAX_PROBLEM_MD_CHARS = 4000;

/** Per-judge-call budget cap for the underlying `claude -p` invocation. */
const JUDGE_MAX_BUDGET_USD = 0.5;

/** Hard wall-clock timeout for a single `claude -p` invocation (ms). */
const JUDGE_TIMEOUT_MS = 120_000;

export type JudgeInput = {
  problemId: string;
  problemMd: string;
  diff: string;
  traceEvents: TraceEvent[];
  failedTestOutput: string;
  hypothesizedAffordance?: string;
};

export type JudgeResult = {
  affordanceLabel: string;
  apiChange: string;
  docFallback: string;
  diagnosis: string;
};

/**
 * System prompt template. Persisted as an exported const so future tweaks can
 * be reviewed in diff and so the test suite can assert against its shape.
 *
 * Note: temperature is no longer settable on `claude -p`; the determinism
 * constraint ("JSON only, no prose, no fences") is encoded in the prompt
 * itself.
 */
export const JUDGE_SYSTEM_PROMPT = `You are an SDK API affordance diagnostician. Your job is to look at a single failed micro-problem produced by an autonomous coding agent ("the AI") that was asked to write code against @tailor-platform/sdk, and identify ONE root affordance gap that explains why the AI got stuck.

Inputs you will receive (in the user message):
- The problem markdown the AI saw.
- A unified diff showing what the AI ended up writing (scaffold -> final).
- A compact trace of the agent's tool calls (Read targets, Bash commands, Edits) — usually the highest-signal subset.
- The failing test output (typecheck or vitest).
- Optionally a hypothesizedAffordance label set by the problem author. If it fits the evidence, prefer it; otherwise pick what fits best.

You MUST respond with a single JSON object and NOTHING else. No prose before, no code fences, no commentary. Exact shape:
{
  "affordanceLabel": "string",
  "apiChange": "string",
  "docFallback": "string",
  "diagnosis": "string"
}

Field semantics:
- affordanceLabel: short snake_case label naming the affordance gap. Prefer one of these 12 seeded labels when it fits: ${SEED_AFFORDANCE_LABELS.join(", ")}. Free-form is allowed if none fit.
- apiChange: a concrete SDK API change that would prevent this failure (e.g. "make createExecutor.description required at the type level"). One sentence.
- docFallback: a cheaper docs-only mitigation if the API change is too invasive (e.g. "add an example to docs/cli/tailordb.md showing db.string().unique()"). One sentence.
- diagnosis: 1-2 sentences describing where the AI got stuck and why. Reference the evidence (which file it read, which bash command it looped on, which type error it hit).

If the AI's behaviour does not match any single root cause, return affordanceLabel "uncategorized" and explain in diagnosis. Never invent evidence not present in the input.`;

/**
 * Pluggable invocation function. Production code spawns `claude -p`; tests
 * replace this with a mock that returns canned stdout/stderr/exit-code
 * without touching the real CLI.
 */
export type JudgeCliRunner = (params: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<string>;

let runnerOverride: JudgeCliRunner | null = null;

/**
 * Test seam: tests inject a mock via `setJudgeCliRunner`. Production code
 * leaves this `null` so the real `claude -p` spawn path is used.
 */
export function setJudgeCliRunner(runner: JudgeCliRunner | null): void {
  runnerOverride = runner;
}

function truncate(text: string, limit: number, tail = "\n[...truncated]"): string {
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - tail.length)) + tail;
}

function buildUserPrompt(input: JudgeInput, traceSummary: string): string {
  const sections: string[] = [];
  sections.push(`problemId: ${input.problemId}`);
  if (input.hypothesizedAffordance) {
    sections.push(`hypothesizedAffordance: ${input.hypothesizedAffordance}`);
  }
  sections.push("\n--- problem.md ---");
  sections.push(truncate(input.problemMd, MAX_PROBLEM_MD_CHARS));
  sections.push("\n--- diff (scaffold -> final) ---");
  sections.push(truncate(input.diff, MAX_DIFF_CHARS));
  sections.push("\n--- trace (compact) ---");
  sections.push(traceSummary || "(no trace events recorded)");
  sections.push("\n--- failed test output ---");
  sections.push(
    truncate(input.failedTestOutput || "(no failed test output captured)", MAX_FAILED_TEST_CHARS),
  );
  return sections.join("\n");
}

const PLACEHOLDER_LABEL = "uncategorized";

function placeholder(raw: string): JudgeResult {
  return {
    affordanceLabel: PLACEHOLDER_LABEL,
    apiChange: "",
    docFallback: "",
    diagnosis: raw.slice(0, 1000),
  };
}

/**
 * Extract a JSON object from a model response. Models sometimes wrap the
 * answer in code fences or prepend a "Here is the diagnosis:" preamble, so we
 * locate the first balanced `{...}` block and try to parse it.
 */
export function extractJudgeJson(raw: string): JudgeResult | null {
  if (!raw) return null;
  const startIdx = raw.indexOf("{");
  if (startIdx === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = startIdx; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\" && i + 1 < raw.length) {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = raw.slice(startIdx, i + 1);
        try {
          const parsed = JSON.parse(candidate) as Partial<JudgeResult>;
          if (typeof parsed.affordanceLabel !== "string") return null;
          return {
            affordanceLabel: parsed.affordanceLabel,
            apiChange: typeof parsed.apiChange === "string" ? parsed.apiChange : "",
            docFallback: typeof parsed.docFallback === "string" ? parsed.docFallback : "",
            diagnosis: typeof parsed.diagnosis === "string" ? parsed.diagnosis : "",
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Verify the `claude` CLI is on PATH and runnable. Auth (OAuth token /
 * keychain) is *not* checked here — that surfaces at the actual `claude -p`
 * call with a descriptive stderr message. We just want a fast pre-flight so
 * users get a clear error if the CLI is missing entirely.
 */
function ensureClaudeCliAvailable(): void {
  try {
    execFileSync("claude", ["--version"], { stdio: "pipe", timeout: 10_000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `claude CLI not available (${message.split("\n")[0] ?? "unknown"}). ` +
        "Install Claude Code and run `claude setup-token`, then export CLAUDE_CODE_OAUTH_TOKEN. " +
        "Alternatively run with LLM_CHALLENGE_DISABLE_JUDGE=1 to skip judging.",
    );
  }
}

/**
 * Spawn `claude -p` with the given prompts, capture stdout, and return the
 * extracted assistant message text. Throws on non-zero exit or unparseable
 * output so the caller can decide whether to retry or surface the error.
 *
 * Runs on the host (NOT inside podman) because the judge does not execute
 * any solver-generated SDK code — it only reads pre-captured failure
 * evidence. Host invocation lets us reuse the user's `CLAUDE_CODE_OAUTH_TOKEN`
 * directly without a container mount.
 */
async function runClaudeCli(systemPrompt: string, userPrompt: string): Promise<string> {
  const args = [
    "-p",
    userPrompt,
    "--output-format",
    "json",
    "--append-system-prompt",
    systemPrompt,
    "--model",
    JUDGE_MODEL,
    "--max-budget-usd",
    String(JUDGE_MAX_BUDGET_USD),
    "--no-session-persistence",
    // Disable all tools — judge is pure inference, no file/bash access needed.
    "--tools",
    "",
  ];

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, JUDGE_TIMEOUT_MS);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`claude CLI spawn failed: ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      if (timedOut) {
        reject(new Error(`claude CLI timed out after ${JUDGE_TIMEOUT_MS}ms`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `claude CLI exited with code ${code}: ${(stderr || stdout).slice(0, 500) || "no output"}`,
          ),
        );
        return;
      }

      const parsed = parseClaudeJsonOutput(stdout);
      if (!parsed.parsed) {
        reject(
          new Error(
            `claude CLI returned unparseable output: ${(stdout || stderr).slice(0, 500) || "empty"}`,
          ),
        );
        return;
      }
      if (parsed.isError) {
        reject(new Error(`claude CLI reported error: ${parsed.result.slice(0, 500)}`));
        return;
      }
      resolve(parsed.result.trim());
    });
  });
}

async function callJudge(systemPrompt: string, userPrompt: string): Promise<string> {
  if (runnerOverride) {
    return runnerOverride({ systemPrompt, userPrompt });
  }
  return runClaudeCli(systemPrompt, userPrompt);
}

/**
 * Diagnose a failed micro-problem using Claude Haiku via the `claude -p`
 * CLI. Returns a parsed `JudgeResult` on success; falls back to a placeholder
 * with the raw response as the diagnosis when both the primary call and the
 * strict retry fail to yield valid JSON.
 *
 * Throws synchronously (before any CLI spawn) when the `claude` CLI is not
 * on PATH. Callers should catch and either retry without judging or surface
 * the error to the user.
 */
export async function judgeFailure(input: JudgeInput): Promise<JudgeResult> {
  // Pre-flight: only run the CLI presence check when no test-runner override
  // is installed. Tests stub the runner and have no business spawning
  // `claude --version`.
  if (!runnerOverride) {
    ensureClaudeCliAvailable();
  }

  const traceSummary = summarizeTraceForJudge(input.traceEvents);
  const userPrompt = buildUserPrompt(input, traceSummary);

  const firstResponse = await callJudge(JUDGE_SYSTEM_PROMPT, userPrompt);
  const parsed = extractJudgeJson(firstResponse);
  if (parsed) return parsed;

  // Retry once with a stricter follow-up.
  const stricterSystem =
    JUDGE_SYSTEM_PROMPT +
    "\n\nIMPORTANT RETRY: the previous response could not be parsed as JSON. Respond with ONLY the raw JSON object. No prose. No code fences.";
  const secondResponse = await callJudge(stricterSystem, userPrompt);
  const parsedRetry = extractJudgeJson(secondResponse);
  if (parsedRetry) return parsedRetry;

  console.warn(
    `[judge] Could not parse JSON for problem ${input.problemId} after retry; returning placeholder.`,
  );
  return placeholder(secondResponse || firstResponse);
}

/**
 * Compute a unified diff between the pre-solve scaffold tree and the
 * post-solve work tree. Uses `git diff --no-index` so the output is the
 * canonical patch format judges and humans both understand.
 */
export function computeWorkDiff(scaffoldDir: string, workDir: string): string {
  if (!fs.existsSync(scaffoldDir) || !fs.existsSync(workDir)) {
    return "";
  }
  try {
    // git diff exits with code 1 when diffs exist; execFileSync throws in that
    // case but still attaches stdout. Capture both paths.
    execFileSync(
      "git",
      ["--no-pager", "diff", "--no-index", "--no-color", "--no-renames", scaffoldDir, workDir],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return ""; // identical trees
  } catch (err) {
    const e = err as { stdout?: Buffer | string; status?: number };
    const stdout = typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString("utf-8") ?? "");
    if (e.status === 1) return stdout;
    return stdout || "";
  }
}

// Tool-name → input key whose value is the most informative summary string.
const TOOL_DETAIL_KEY: Record<string, string> = {
  Read: "file_path",
  Edit: "file_path",
  Write: "file_path",
  Bash: "command",
  Glob: "pattern",
  Grep: "pattern",
};

function pickToolDetail(event: TraceEvent & { kind: "tool_use" }): string {
  const key = TOOL_DETAIL_KEY[event.name];
  const candidate = key ? event.input[key] : undefined;
  let detail = typeof candidate === "string" ? candidate : "";
  if (!detail) {
    // Generic fallback: first string arg.
    for (const v of Object.values(event.input)) {
      if (typeof v === "string") {
        detail = v;
        break;
      }
    }
  }
  return detail.length > 120 ? detail.slice(0, 117) + "..." : detail;
}

/**
 * Compact textual summary of the trace for the judge prompt. Picks the most
 * signal-bearing events (tool_use names + first string arg) capped at
 * `MAX_TRACE_EVENTS_IN_PROMPT`, biased toward the LAST occurrences (most
 * relevant to the failure), plus the final result event when present.
 */
export function summarizeTraceForJudge(events: TraceEvent[]): string {
  const toolEvents: { event: TraceEvent & { kind: "tool_use" }; idx: number }[] = [];
  let result: (TraceEvent & { kind: "result" }) | undefined;
  events.forEach((event, idx) => {
    if (event.kind === "tool_use") toolEvents.push({ event, idx });
    else if (event.kind === "result") result = event;
  });

  const overflow = Math.max(0, toolEvents.length - MAX_TRACE_EVENTS_IN_PROMPT);
  const picked = overflow > 0 ? toolEvents.slice(overflow) : toolEvents;

  const lines: string[] = [];
  if (overflow > 0) {
    lines.push(`(showing last ${picked.length} of ${toolEvents.length} tool_use events)`);
  }
  for (const { event, idx } of picked) {
    const detail = pickToolDetail(event);
    lines.push(`#${idx} ${event.name}${detail ? `: ${detail}` : ""}`);
  }
  if (result) {
    const tail = result.text ? `: ${result.text.slice(0, 200)}` : "";
    lines.push(`result isError=${result.isError}${tail}`);
  }
  return lines.join("\n");
}

/**
 * Concatenate the `output` of every failed stage into a single string,
 * truncated to `MAX_FAILED_TEST_CHARS`. Returns the empty string when no
 * stage failed (judge caller should not even invoke us in that case, but we
 * stay defensive).
 */
export function extractFailedTestOutput(stages: StageResult[]): string {
  const parts: string[] = [];
  for (const s of stages) {
    if (s.passed) continue;
    if (!s.output) continue;
    parts.push(`### stage: ${s.stage}\n${s.output}`);
  }
  return truncate(parts.join("\n\n"), MAX_FAILED_TEST_CHARS);
}

/**
 * Read a trace.jsonl file and parse each line into a `TraceEvent`. Mirrors
 * `computeTraceMetrics` but returns the typed events instead of aggregates.
 * Silently tolerates a missing file or malformed lines.
 */
export function readTraceEvents(tracePath: string): TraceEvent[] {
  let content: string;
  try {
    content = fs.readFileSync(tracePath, "utf-8");
  } catch {
    return [];
  }
  const events: TraceEvent[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TraceEvent);
    } catch {
      // skip malformed line
    }
  }
  return events;
}

/**
 * Resolve the scaffold-equivalent tree for diff computation. We need both
 * shared layers and the per-problem scaffold; we materialise a temporary
 * merged tree because `git diff --no-index` cannot accept multiple sources.
 *
 * The challenge root passes the layered scaffolds via this helper. Falls back
 * to the per-problem `scaffold/` only when the shared layers do not exist.
 */
export function resolveScaffoldLayers(challengeRoot: string, problemDir: string): string[] {
  const layers = [
    path.join(challengeRoot, "shared", "scaffold"),
    path.join(challengeRoot, "problems", "_shared", "scaffold"),
    path.join(problemDir, "scaffold"),
  ];
  return layers.filter((l) => fs.existsSync(l));
}
