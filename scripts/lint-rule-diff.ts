#!/usr/bin/env -S pnpm exec tsx
// Lint-rule diff: shows which rules ESLint enforces today that oxlint does not.
//
// Usage:
//   pnpm exec tsx scripts/lint-rule-diff.ts
//   pnpm exec tsx scripts/lint-rule-diff.ts --pkg=packages/sdk
//   pnpm exec tsx scripts/lint-rule-diff.ts --json=scripts/lint-rule-diff.baseline.json
//
// Now that ESLint is gone, packages without an `eslint.config.js` are reported
// as "ESLint not configured" and the gap is treated as zero — the script still
// records the oxlint snapshot so dependency upgrades can be audited against
// the committed baseline. The exit code is non-zero only when a package that
// still has ESLint configured leaves some rules uncovered by oxlint.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import picomatch from "picomatch";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadOxlintRegisteredRules(): { rules: Set<string>; version: string } {
  const out = execFileSync("pnpm", ["--silent", "exec", "oxlint", "--rules"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const rules = new Set<string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^\|\s+([\w/-]+)\s+\|\s+(\w+)\s+\|/);
    if (!m) continue;
    const name = m[1];
    const source = m[2];
    // Skip the header row.
    if (name === "Rule" || name === "name") continue;
    // oxlint outputs rule short names. Most are unqualified (e.g. `no-cycle`
    // from import plugin). For grouping, register both short and prefixed.
    rules.add(name);
    if (source === "typescript" || source === "import" || source === "jsdoc") {
      rules.add(`${source}/${name}`);
    }
  }
  const versionLine = execFileSync("pnpm", ["--silent", "exec", "oxlint", "--version"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const version = versionLine.match(/Version:\s*([\d.]+)/)?.[1] ?? "unknown";
  return { rules, version };
}

const OXLINT_REGISTRY = loadOxlintRegisteredRules();
console.error(
  `oxlint version: ${OXLINT_REGISTRY.version}, registered rules: ${OXLINT_REGISTRY.rules.size}`,
);

function oxlintHasRule(normalised: string): boolean {
  if (OXLINT_REGISTRY.rules.has(normalised)) return true;
  // Try the short name (e.g. `typescript/no-explicit-any` → `no-explicit-any`).
  const short = normalised.includes("/") ? (normalised.split("/").pop() ?? normalised) : normalised;
  return OXLINT_REGISTRY.rules.has(short);
}

interface Pkg {
  name: string;
  dir: string;
  pnpmFilter: string;
  oxlintrc: string | null;
  eslintConfig: string | null;
}

const packages: Pkg[] = [
  {
    name: "@tailor-platform/sdk",
    dir: "packages/sdk",
    pnpmFilter: "@tailor-platform/sdk",
    oxlintrc: "packages/sdk/.oxlintrc.json",
    eslintConfig: "packages/sdk/eslint.config.js",
  },
  {
    name: "@tailor-platform/create-sdk",
    dir: "packages/create-sdk",
    pnpmFilter: "@tailor-platform/create-sdk",
    oxlintrc: "packages/create-sdk/.oxlintrc.json",
    eslintConfig: "packages/create-sdk/eslint.config.js",
  },
  {
    name: "@tailor-platform/sdk-codemod",
    dir: "packages/sdk-codemod",
    pnpmFilter: "@tailor-platform/sdk-codemod",
    oxlintrc: "packages/sdk-codemod/.oxlintrc.json",
    eslintConfig: "packages/sdk-codemod/eslint.config.js",
  },
  {
    name: "example",
    dir: "example",
    pnpmFilter: "example",
    oxlintrc: "example/.oxlintrc.json",
    eslintConfig: "example/eslint.config.js",
  },
];

type Severity = "off" | "warn" | "error";

function normaliseEslintSeverity(value: unknown): Severity {
  const sev = Array.isArray(value) ? value[0] : value;
  if (sev === 0 || sev === "off") return "off";
  if (sev === 1 || sev === "warn") return "warn";
  return "error";
}

function normaliseOxlintSeverity(value: unknown): Severity {
  const sev = Array.isArray(value) ? value[0] : value;
  if (sev === "off" || sev === "allow" || sev === 0) return "off";
  if (sev === "warn" || sev === 1) return "warn";
  return "error";
}

const RULE_NAMESPACE_MAP: Record<string, string> = {
  "@typescript-eslint/": "typescript/",
  "import-x/": "import/",
};

// Rules whose TS-extended variant maps back to the base ESLint rule in oxlint
// (e.g. `@typescript-eslint/no-restricted-imports` is just an extension of the
// base rule with `allowTypeImports`; oxlint exposes only the base name).
const TS_TO_BASE_RULES = new Set([
  "no-restricted-imports",
  "no-unused-vars",
  "no-array-constructor",
  "no-empty-function",
  "no-unused-expressions",
  "no-shadow",
  "no-loop-func",
  "no-magic-numbers",
  "default-param-last",
]);

function normaliseRuleName(rule: string): string {
  if (rule.startsWith("@typescript-eslint/")) {
    const base = rule.slice("@typescript-eslint/".length);
    if (TS_TO_BASE_RULES.has(base)) return base;
    return `typescript/${base}`;
  }
  for (const [from, to] of Object.entries(RULE_NAMESPACE_MAP)) {
    if (rule.startsWith(from)) return to + rule.slice(from.length);
  }
  return rule;
}

const EXCLUDED_DIR_PATTERN =
  /(^|\/)(dist|node_modules|\.tailor-sdk|generated|generated-perf|templates)\/|__test_fixtures__\/dist\//;

function listFiles(pkg: Pkg): string[] {
  const out = execFileSync(
    "git",
    [
      "ls-files",
      `${pkg.dir}/**/*.ts`,
      `${pkg.dir}/**/*.tsx`,
      `${pkg.dir}/**/*.mts`,
      `${pkg.dir}/**/*.cts`,
      `${pkg.dir}/**/*.js`,
      `${pkg.dir}/**/*.mjs`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out.split("\n").filter((f) => f.length > 0 && !EXCLUDED_DIR_PATTERN.test(f));
}

function sampleFiles(files: string[]): string[] {
  // Cluster by parent directory + presence of `.test.` in basename.
  // Pick one representative per cluster so every override scope is covered.
  const buckets = new Map<string, string>();
  for (const f of files) {
    const dir = f.slice(0, f.lastIndexOf("/"));
    const isTest = /\.(test|spec)\.[mc]?[tj]sx?$/.test(f);
    const isJs = /\.[mc]?js$/.test(f);
    const key = `${dir}|${isTest ? "test" : "src"}|${isJs ? "js" : "ts"}`;
    if (!buckets.has(key)) buckets.set(key, f);
  }
  return [...buckets.values()];
}

interface FileRuleMap {
  [rule: string]: Severity;
}

function runEslintPrintConfig(pkg: Pkg, relPath: string): FileRuleMap | null {
  const out = execFileSync(
    "pnpm",
    [
      "--silent",
      "--filter",
      pkg.pnpmFilter,
      "exec",
      "eslint",
      "--print-config",
      relative(pkg.dir, resolve(repoRoot, relPath)),
    ],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  // ESLint emits the literal string "undefined" on stdout when the file is
  // matched by globalIgnores. Skip these silently.
  if (out.trim() === "undefined") return null;
  const json = JSON.parse(out) as { rules?: Record<string, unknown> };
  const map: FileRuleMap = {};
  for (const [name, value] of Object.entries(json.rules ?? {})) {
    map[name] = normaliseEslintSeverity(value);
  }
  return map;
}

interface OxlintConfig {
  rules?: Record<string, unknown>;
  overrides?: { files: string[]; rules?: Record<string, unknown> }[];
}

// oxlint's native plugins use these namespaces. Anything else is a custom JS
// plugin rule (e.g. `local/*`) that `oxlint --print-config` strips from its
// output and we have to layer back in from the raw .oxlintrc.json.
const OXLINT_NATIVE_NAMESPACES = new Set([
  "typescript",
  "import",
  "jsdoc",
  "unicorn",
  "react",
  "jest",
  "vitest",
  "promise",
  "node",
  "nextjs",
  "vue",
  "react-perf",
  "jsx-a11y",
  "oxc",
]);

function isLocalRule(name: string): boolean {
  const slash = name.indexOf("/");
  if (slash === -1) return false;
  return !OXLINT_NATIVE_NAMESPACES.has(name.slice(0, slash));
}

function loadOxlintConfig(pkg: Pkg): OxlintConfig | null {
  if (!pkg.oxlintrc) return null;
  // `oxlint --print-config` resolves `categories` to concrete rule names —
  // the only way to know that `categories.correctness = "error"` enables
  // ~218 rules. But JS plugin rules (anything under `jsPlugins` / the
  // `local/*` namespace) are stripped from that output, so we layer the raw
  // `.oxlintrc.json`'s `rules` and `overrides` for namespaces that
  // `--print-config` does not understand.
  let resolved: OxlintConfig | null = null;
  try {
    const out = execFileSync(
      "pnpm",
      ["--silent", "--filter", pkg.pnpmFilter, "exec", "oxlint", "--print-config"],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    resolved = JSON.parse(out) as OxlintConfig;
  } catch {
    // fall through to raw-config fallback below
  }

  const rawPath = resolve(repoRoot, pkg.oxlintrc);
  const raw = existsSync(rawPath)
    ? (JSON.parse(readFileSync(rawPath, "utf8")) as OxlintConfig)
    : null;

  if (!resolved && !raw) return null;
  if (!resolved) return raw;
  if (!raw) return resolved;

  resolved.rules = { ...(resolved.rules ?? {}) };
  for (const [k, v] of Object.entries(raw.rules ?? {})) {
    if (isLocalRule(k)) resolved.rules[k] = v;
  }
  // Match raw overrides by stringified `files`.
  const overrideKey = (o: { files: string[] }) => JSON.stringify(o.files);
  const byFiles = new Map<string, { files: string[]; rules?: Record<string, unknown> }>();
  for (const o of resolved.overrides ?? []) byFiles.set(overrideKey(o), o);
  for (const o of raw.overrides ?? []) {
    const key = overrideKey(o);
    const target = byFiles.get(key);
    if (!target) {
      // Override exists in raw but not in resolved (shouldn't happen);
      // append as-is filtered to local rules.
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o.rules ?? {})) {
        if (isLocalRule(k)) filtered[k] = v;
      }
      if (Object.keys(filtered).length > 0) {
        (resolved.overrides ??= []).push({ files: o.files, rules: filtered });
      }
      continue;
    }
    target.rules = { ...(target.rules ?? {}) };
    for (const [k, v] of Object.entries(o.rules ?? {})) {
      if (isLocalRule(k)) target.rules[k] = v;
    }
  }
  return resolved;
}

interface CompiledOxlintConfig {
  baseRules: FileRuleMap;
  overrides: { match: (file: string) => boolean; rules: FileRuleMap }[];
}

function compileOxlintConfig(cfg: OxlintConfig): CompiledOxlintConfig {
  const baseRules: FileRuleMap = {};
  for (const [name, value] of Object.entries(cfg.rules ?? {})) {
    baseRules[name] = normaliseOxlintSeverity(value);
  }
  const overrides = (cfg.overrides ?? []).map((override) => {
    const matchers = override.files.map((g) => picomatch(g, { dot: true, contains: true }));
    const rules: FileRuleMap = {};
    for (const [name, value] of Object.entries(override.rules ?? {})) {
      rules[name] = normaliseOxlintSeverity(value);
    }
    return { match: (file: string) => matchers.some((m) => m(file)), rules };
  });
  return { baseRules, overrides };
}

function resolveOxlintRulesForFile(
  compiled: CompiledOxlintConfig,
  fileRelToPkg: string,
): FileRuleMap {
  const map: FileRuleMap = { ...compiled.baseRules };
  for (const override of compiled.overrides) {
    if (!override.match(fileRelToPkg)) continue;
    Object.assign(map, override.rules);
  }
  return map;
}

interface PerFileDiff {
  file: string;
  eslintOnly: { rule: string; severity: Severity }[];
  oxlintOnly: { rule: string; severity: Severity }[];
  severityMismatch: {
    rule: string;
    eslint: Severity;
    oxlint: Severity;
  }[];
}

interface RuleSummary {
  rule: string;
  normalised: string;
  inEslintFiles: string[];
  inOxlintFiles: string[];
}

interface PackageReport {
  pkg: string;
  filesSampled: number;
  eslintOnlyRules: Map<string, RuleSummary>;
  oxlintOnlyRules: Map<string, RuleSummary>;
  severityMismatches: Map<string, { eslint: Severity; oxlint: Severity; files: string[] }>;
  perFile: PerFileDiff[];
  // Snapshot of every rule that resolves to a non-off severity in any sampled
  // file. Used post-ESLint-removal to detect rules silently disappearing on
  // oxlint upgrades.
  oxlintActiveRules: Set<string>;
}

function diffPackage(pkg: Pkg): PackageReport {
  const oxlintCfg = loadOxlintConfig(pkg);
  const compiledOxlint = oxlintCfg ? compileOxlintConfig(oxlintCfg) : null;
  const files = sampleFiles(listFiles(pkg));
  const report: PackageReport = {
    pkg: pkg.name,
    filesSampled: files.length,
    eslintOnlyRules: new Map(),
    oxlintOnlyRules: new Map(),
    severityMismatches: new Map(),
    perFile: [],
    oxlintActiveRules: new Set(),
  };

  const eslintConfigured = !!pkg.eslintConfig && existsSync(resolve(repoRoot, pkg.eslintConfig));

  // Always build the oxlint snapshot — this is what catches regressions after
  // ESLint is gone.
  if (compiledOxlint) {
    for (const file of files) {
      const fileRelToPkg = relative(pkg.dir, file);
      const rules = resolveOxlintRulesForFile(compiledOxlint, fileRelToPkg);
      for (const [rule, sev] of Object.entries(rules)) {
        if (sev !== "off") report.oxlintActiveRules.add(normaliseRuleName(rule));
      }
    }
  }

  if (!eslintConfigured) {
    // ESLint is no longer configured — skip the diff loop, the snapshot above
    // is what subsequent runs compare against.
    return report;
  }

  for (const file of files) {
    let eslintRules: FileRuleMap | null;
    try {
      eslintRules = runEslintPrintConfig(pkg, file);
    } catch (err) {
      // ESLint may refuse to lint some files (e.g. ignored by globalIgnores).
      const msg = err instanceof Error ? err.message : String(err);
      if (/ignored|matches an ignore pattern/i.test(msg)) continue;
      throw err;
    }
    if (!eslintRules) continue;

    const fileRelToPkg = relative(pkg.dir, file);
    const oxlintRules = compiledOxlint
      ? resolveOxlintRulesForFile(compiledOxlint, fileRelToPkg)
      : {};

    // Index oxlint rules by normalised name.
    const oxlintNorm = new Map<string, Severity>();
    for (const [r, s] of Object.entries(oxlintRules)) {
      oxlintNorm.set(normaliseRuleName(r), s);
    }
    const eslintNorm = new Map<string, Severity>();
    for (const [r, s] of Object.entries(eslintRules)) {
      eslintNorm.set(normaliseRuleName(r), s);
    }

    const diff: PerFileDiff = {
      file,
      eslintOnly: [],
      oxlintOnly: [],
      severityMismatch: [],
    };

    for (const [rule, eslintSev] of eslintNorm) {
      if (eslintSev === "off") continue;
      const oxlintSev = oxlintNorm.get(rule) ?? "off";
      if (oxlintSev === "off") {
        diff.eslintOnly.push({ rule, severity: eslintSev });
        let summary = report.eslintOnlyRules.get(rule);
        if (!summary) {
          summary = { rule, normalised: rule, inEslintFiles: [], inOxlintFiles: [] };
          report.eslintOnlyRules.set(rule, summary);
        }
        summary.inEslintFiles.push(file);
      } else if (oxlintSev !== eslintSev) {
        diff.severityMismatch.push({ rule, eslint: eslintSev, oxlint: oxlintSev });
        let s = report.severityMismatches.get(rule);
        if (!s) {
          s = { eslint: eslintSev, oxlint: oxlintSev, files: [] };
          report.severityMismatches.set(rule, s);
        }
        s.files.push(file);
      }
    }
    for (const [rule, oxlintSev] of oxlintNorm) {
      if (oxlintSev === "off") continue;
      const eslintSev = eslintNorm.get(rule) ?? "off";
      if (eslintSev === "off") {
        diff.oxlintOnly.push({ rule, severity: oxlintSev });
        let summary = report.oxlintOnlyRules.get(rule);
        if (!summary) {
          summary = { rule, normalised: rule, inEslintFiles: [], inOxlintFiles: [] };
          report.oxlintOnlyRules.set(rule, summary);
        }
        summary.inOxlintFiles.push(file);
      }
    }
    report.perFile.push(diff);
  }

  return report;
}

function printReport(report: PackageReport): void {
  const ESL = [...report.eslintOnlyRules.values()].sort((a, b) => a.rule.localeCompare(b.rule));
  const OXL = [...report.oxlintOnlyRules.values()].sort((a, b) => a.rule.localeCompare(b.rule));
  const MM = [...report.severityMismatches.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  console.log(`\n# ${report.pkg}  (sampled ${report.filesSampled} files)`);
  console.log(`  ESLint-only rules: ${ESL.length}`);
  console.log(`  oxlint-only rules: ${OXL.length}`);
  console.log(`  severity mismatches: ${MM.length}`);

  if (ESL.length > 0) {
    // Partition once: missing-from-registry first (more urgent), then unenabled.
    const annotated = ESL.map((r) => ({ ...r, exists: oxlintHasRule(r.normalised) }));
    const missingCount = annotated.filter((r) => !r.exists).length;
    console.log(`\n  ## ESLint-only — coverage gap (${ESL.length})`);
    console.log(`     · ${ESL.length - missingCount} rules exist in oxlint but are not enabled`);
    console.log(`     · ${missingCount} rules are NOT in oxlint registry (need workaround)`);
    console.log(`  ${"rule".padEnd(50)} ${"oxlint?".padEnd(8)} ${"files".padEnd(6)}  sample`);
    annotated.sort((a, b) => Number(a.exists) - Number(b.exists));
    for (const r of annotated) {
      const status = r.exists ? "exists" : "MISSING";
      console.log(
        `  ${r.rule.padEnd(50)} ${status.padEnd(8)} ${String(r.inEslintFiles.length).padEnd(6)}  ${r.inEslintFiles[0]}`,
      );
    }
  }
  if (OXL.length > 0) {
    console.log(`\n  ## oxlint-only (enforced by oxlint, off in ESLint)`);
    for (const r of OXL) {
      console.log(`  - ${r.rule}  [${r.inOxlintFiles.length} file(s)]`);
    }
  }
  if (MM.length > 0) {
    console.log(`\n  ## severity mismatches (oxlint vs eslint)`);
    for (const [rule, info] of MM) {
      console.log(
        `  - ${rule}: eslint=${info.eslint} oxlint=${info.oxlint}  [${info.files.length} file(s)]`,
      );
    }
  }
}

function serialisableReport(report: PackageReport) {
  return {
    pkg: report.pkg,
    filesSampled: report.filesSampled,
    eslintOnly: [...report.eslintOnlyRules.values()].map((r) => ({
      rule: r.rule,
      normalised: r.normalised,
      oxlintHasRule: oxlintHasRule(r.normalised),
      files: r.inEslintFiles,
    })),
    oxlintOnly: [...report.oxlintOnlyRules.values()].map((r) => ({
      rule: r.rule,
      files: r.inOxlintFiles,
    })),
    severityMismatch: [...report.severityMismatches.entries()].map(([rule, info]) => ({
      rule,
      eslint: info.eslint,
      oxlint: info.oxlint,
      files: info.files,
    })),
    oxlintActiveRules: [...report.oxlintActiveRules].sort(),
  };
}

const args = process.argv.slice(2);
const writeJson = args.find((a) => a.startsWith("--json="))?.slice("--json=".length);
const onlyPackage = args.find((a) => a.startsWith("--pkg="))?.slice("--pkg=".length);
const compareBaselinePath = args.find((a) => a.startsWith("--check="))?.slice("--check=".length);

const reports: ReturnType<typeof serialisableReport>[] = [];
let totalEslintOnly = 0;
for (const pkg of packages) {
  if (onlyPackage && pkg.dir !== onlyPackage && pkg.name !== onlyPackage) continue;
  console.error(`\n# Diffing ${pkg.name} ...`);
  const report = diffPackage(pkg);
  printReport(report);
  reports.push(serialisableReport(report));
  totalEslintOnly += report.eslintOnlyRules.size;
}

if (writeJson) {
  writeFileSync(resolve(repoRoot, writeJson), JSON.stringify(reports, null, 2) + "\n");
  console.error(`\nWrote ${writeJson}`);
}

let regressed = 0;
if (compareBaselinePath) {
  const baselineRaw = readFileSync(resolve(repoRoot, compareBaselinePath), "utf8");
  const baseline = JSON.parse(baselineRaw) as ReturnType<typeof serialisableReport>[];
  console.log(`\n## oxlint rule snapshot vs ${compareBaselinePath}`);
  for (const report of reports) {
    const prior = baseline.find((b) => b.pkg === report.pkg);
    if (!prior) {
      console.log(`  - ${report.pkg}: no baseline entry, skipping`);
      continue;
    }
    const priorRules = new Set(prior.oxlintActiveRules ?? []);
    const dropped = [...priorRules].filter((r) => !report.oxlintActiveRules.includes(r));
    const added = report.oxlintActiveRules.filter((r) => !priorRules.has(r));
    if (dropped.length === 0 && added.length === 0) {
      console.log(`  - ${report.pkg}: unchanged (${priorRules.size} rules)`);
      continue;
    }
    regressed += dropped.length;
    if (dropped.length > 0) {
      console.log(`  - ${report.pkg}: ${dropped.length} rule(s) DROPPED`);
      for (const r of dropped) console.log(`      - ${r}`);
    }
    if (added.length > 0) {
      console.log(`  - ${report.pkg}: ${added.length} rule(s) added`);
      for (const r of added) console.log(`      + ${r}`);
    }
  }
}

console.log(`\n=== TOTAL ESLint-only rule occurrences across packages: ${totalEslintOnly} ===`);
if (compareBaselinePath) {
  console.log(`=== TOTAL oxlint rules dropped vs baseline: ${regressed} ===`);
}
process.exit(totalEslintOnly > 0 || regressed > 0 ? 1 : 0);
