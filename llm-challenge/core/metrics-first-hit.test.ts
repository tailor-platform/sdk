import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TraceEvent } from "./trace";
import {
  aggregateFirstHit,
  classifyFirstBiasMiss,
  classifyFirstHit,
  classifyFirstHitFromTraceFile,
  extractGrepArgs,
  extractPatternFromArgs,
  matchAnyCanonical,
  tokenize,
  unwrapBashLc,
} from "./metrics-first-hit";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function bash(command: string): TraceEvent {
  return { kind: "tool_use", name: "Bash", input: { command } };
}

function read(filePath: string): TraceEvent {
  return { kind: "tool_use", name: "Read", input: { file_path: filePath } };
}

describe("tokenize", () => {
  it("splits on whitespace and preserves double-quoted strings", () => {
    expect(tokenize('rg "foo bar" baz')).toEqual(["rg", "foo bar", "baz"]);
  });

  it("preserves single-quoted strings", () => {
    expect(tokenize("rg 'foo bar' baz")).toEqual(["rg", "foo bar", "baz"]);
  });

  it("handles escaped quotes inside double quotes", () => {
    expect(tokenize('rg "foo \\"bar\\"" baz')).toEqual(["rg", 'foo "bar"', "baz"]);
  });

  it("returns empty list for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("unwrapBashLc", () => {
  it("strips bash -lc wrapper with single quotes", () => {
    expect(unwrapBashLc("bash -lc 'rg foo'")).toBe("rg foo");
  });

  it("strips /bin/bash -c wrapper with double quotes", () => {
    expect(unwrapBashLc('/bin/bash -c "rg foo"')).toBe("rg foo");
  });

  it("strips sh -c wrapper", () => {
    expect(unwrapBashLc("sh -c 'grep foo'")).toBe("grep foo");
  });

  it("returns the command unchanged when there is no wrapper", () => {
    expect(unwrapBashLc("rg foo bar")).toBe("rg foo bar");
  });
});

describe("extractGrepArgs", () => {
  it("returns args for an rg invocation", () => {
    expect(extractGrepArgs("rg definePlugins")).toEqual(["definePlugins"]);
  });

  it("returns args for a grep -r invocation", () => {
    expect(extractGrepArgs("grep -r kyselyTypePlugin node_modules")).toEqual([
      "-r",
      "kyselyTypePlugin",
      "node_modules",
    ]);
  });

  it("returns null for a non-grep command", () => {
    expect(extractGrepArgs("ls node_modules")).toBeNull();
    expect(extractGrepArgs("cat package.json")).toBeNull();
  });

  it("stops at the first pipe so rg foo | head still parses", () => {
    expect(extractGrepArgs("rg definePlugins | head -1")).toEqual(["definePlugins"]);
  });

  it("stops at && so chained shell still parses", () => {
    expect(extractGrepArgs("rg foo && echo ok")).toEqual(["foo"]);
  });
});

describe("extractPatternFromArgs", () => {
  it("returns the first positional pattern", () => {
    expect(extractPatternFromArgs(["definePlugins"])).toBe("definePlugins");
    expect(extractPatternFromArgs(["definePlugins", "node_modules"])).toBe("definePlugins");
  });

  it("skips flags without values", () => {
    expect(extractPatternFromArgs(["-r", "definePlugins", "."])).toBe("definePlugins");
    expect(extractPatternFromArgs(["-i", "-r", "definePlugins"])).toBe("definePlugins");
  });

  it("skips flags whose value is the next token", () => {
    expect(extractPatternFromArgs(["-t", "ts", "definePlugins"])).toBe("definePlugins");
    expect(extractPatternFromArgs(["-g", "*.ts", "definePlugins"])).toBe("definePlugins");
  });

  it("honors -e <pattern> over a later positional", () => {
    expect(extractPatternFromArgs(["-e", "definePlugins", "extra"])).toBe("definePlugins");
  });

  it("honors --regexp=<pattern> form", () => {
    expect(extractPatternFromArgs(["--regexp=definePlugins"])).toBe("definePlugins");
  });

  it("returns null when no pattern is present", () => {
    expect(extractPatternFromArgs([])).toBeNull();
    expect(extractPatternFromArgs(["-r"])).toBeNull();
  });
});

describe("matchAnyCanonical", () => {
  const symbols = ["kyselyTypePlugin", "definePlugins", "getDB"];

  it("treats the pattern as a regex", () => {
    expect(matchAnyCanonical("definePlugins", symbols)).toBe("definePlugins");
    expect(matchAnyCanonical("define.*lugins", symbols)).toBe("definePlugins");
  });

  it("matches case-sensitively by default (no implicit -i)", () => {
    expect(matchAnyCanonical("defineplugins", symbols)).toBeNull();
  });

  it("matches partial regexes against the symbol", () => {
    expect(matchAnyCanonical("kysely", symbols)).toBe("kyselyTypePlugin");
  });

  it("falls back to substring match when the pattern is not a valid regex", () => {
    // Stray `[` makes the regex invalid; substring fallback should kick in
    // so we don't accidentally classify a typo as `no-match`.
    expect(matchAnyCanonical("getDB[", symbols)).toBe("getDB");
  });

  it("returns null when nothing matches", () => {
    expect(matchAnyCanonical("composePlugins", symbols)).toBeNull();
  });
});

describe("classifyFirstHit", () => {
  const canonical = ["kyselyTypePlugin", "definePlugins", "getDB"];

  it("returns `hit` when the first rg command names a canonical symbol", () => {
    const events: TraceEvent[] = [
      { kind: "thinking", text: "Need to find the plugins helper" },
      bash("rg definePlugins node_modules/@tailor-platform/sdk"),
      bash("rg getDB packages/sdk/dist"),
    ];
    const result = classifyFirstHit(events, canonical);
    expect(result.outcome).toBe("hit");
    expect(result.matchedSymbol).toBe("definePlugins");
  });

  it("ignores non-Bash events when looking for the first grep", () => {
    const events: TraceEvent[] = [
      read("README.md"),
      read("package.json"),
      bash("rg kyselyTypePlugin ."),
    ];
    expect(classifyFirstHit(events, canonical).outcome).toBe("hit");
  });

  it("ignores Bash events that aren't grep invocations", () => {
    const events: TraceEvent[] = [
      bash("ls node_modules/@tailor-platform/sdk"),
      bash("cat node_modules/@tailor-platform/sdk/package.json"),
      bash("rg definePlugins ."),
    ];
    expect(classifyFirstHit(events, canonical).outcome).toBe("hit");
  });

  it("skips patternless grep listings like `rg --files`", () => {
    const events: TraceEvent[] = [
      bash("rg --files node_modules/@tailor-platform/sdk"),
      bash("rg definePlugins ."),
    ];
    const result = classifyFirstHit(events, canonical);
    expect(result.outcome).toBe("hit");
    expect(result.pattern).toBe("definePlugins");
  });

  it("returns `no_grep` when every grep call is patternless (e.g. only file listings)", () => {
    const events: TraceEvent[] = [bash("rg --files node_modules"), bash("rg -l")];
    expect(classifyFirstHit(events, canonical).outcome).toBe("no_grep");
  });

  it("returns `miss` when the first grep pattern doesn't match any canonical symbol", () => {
    const events: TraceEvent[] = [bash("rg composePlugins .")];
    const result = classifyFirstHit(events, canonical);
    expect(result.outcome).toBe("miss");
    expect(result.pattern).toBe("composePlugins");
  });

  it("unwraps bash -lc wrappers (codex emits these)", () => {
    const events: TraceEvent[] = [bash("bash -lc 'rg definePlugins'")];
    expect(classifyFirstHit(events, canonical).outcome).toBe("hit");
  });

  it("returns `no_grep` when the agent never invoked a grep tool", () => {
    const events: TraceEvent[] = [read("README.md"), bash("ls node_modules")];
    expect(classifyFirstHit(events, canonical).outcome).toBe("no_grep");
  });

  it("returns `no_grep` for an empty trace", () => {
    expect(classifyFirstHit([], canonical).outcome).toBe("no_grep");
  });
});

describe("classifyFirstBiasMiss", () => {
  const attractors = ["composePlugins", "addPlugins", "createJob"];

  it("flags a grep whose first pattern matches a bias attractor", () => {
    const events: TraceEvent[] = [bash("rg composePlugins .")];
    const result = classifyFirstBiasMiss(events, attractors);
    expect(result.isBiasMiss).toBe(true);
    expect(result.matchedAttractor).toBe("composePlugins");
  });

  it("returns false when the grep doesn't hit any attractor", () => {
    const events: TraceEvent[] = [bash("rg definePlugins .")];
    expect(classifyFirstBiasMiss(events, attractors).isBiasMiss).toBe(false);
  });

  it("returns false when the agent never grepped", () => {
    expect(classifyFirstBiasMiss([read("foo")], attractors).isBiasMiss).toBe(false);
  });
});

describe("classifyFirstHitFromTraceFile", () => {
  function writeTrace(events: TraceEvent[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-first-hit-"));
    tmpDirs.push(dir);
    const traceFile = path.join(dir, "trace.jsonl");
    fs.writeFileSync(traceFile, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    return traceFile;
  }

  it("reads a JSONL trace and classifies the first hit", () => {
    const traceFile = writeTrace([bash("rg getDB packages/")]);
    const result = classifyFirstHitFromTraceFile(traceFile, ["getDB"]);
    expect(result.outcome).toBe("hit");
    expect(result.matchedSymbol).toBe("getDB");
  });

  it("tolerates a missing trace file", () => {
    const result = classifyFirstHitFromTraceFile("/nonexistent/trace-xyz.jsonl", ["getDB"]);
    expect(result.outcome).toBe("no_grep");
  });

  it("skips malformed lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-first-hit-malformed-"));
    tmpDirs.push(dir);
    const traceFile = path.join(dir, "trace.jsonl");
    fs.writeFileSync(traceFile, `${["not-json", JSON.stringify(bash("rg getDB"))].join("\n")}\n`);
    const result = classifyFirstHitFromTraceFile(traceFile, ["getDB"]);
    expect(result.outcome).toBe("hit");
  });
});

describe("aggregateFirstHit", () => {
  it("counts outcomes and computes hit rate", () => {
    const stats = aggregateFirstHit("h08", [
      { outcome: "hit" },
      { outcome: "hit" },
      { outcome: "miss" },
      { outcome: "no_grep" },
    ]);
    expect(stats).toEqual({
      problemId: "h08",
      hits: 2,
      misses: 1,
      noGrep: 1,
      hitRate: 2 / 3,
    });
  });

  it("returns hit rate 0 when there are no countable iterations", () => {
    const stats = aggregateFirstHit("h08", [{ outcome: "no_grep" }]);
    expect(stats.hitRate).toBe(0);
  });

  it("handles an empty input", () => {
    expect(aggregateFirstHit("h08", [])).toEqual({
      problemId: "h08",
      hits: 0,
      misses: 0,
      noGrep: 0,
      hitRate: 0,
    });
  });
});
