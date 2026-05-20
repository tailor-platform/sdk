#!/usr/bin/env -S pnpm exec tsx
// oxlint rule snapshot: detects rules that silently disappear after an oxlint
// upgrade (or a config edit).
//
// Usage:
//   pnpm exec tsx scripts/lint-rule-diff.ts
//   pnpm exec tsx scripts/lint-rule-diff.ts --pkg=packages/sdk
//   pnpm exec tsx scripts/lint-rule-diff.ts --json=scripts/lint-rule-diff.baseline.json
//   pnpm exec tsx scripts/lint-rule-diff.ts --check=scripts/lint-rule-diff.baseline.json
//
// For each package we sample one file per (directory, test|src, js|ts) bucket,
// resolve the effective oxlint rule severity for that file, and collect the
// union of rules that resolve to a non-off severity. `--check` exits non-zero
// when any rule active in the baseline is no longer enforced.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import picomatch from "picomatch";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Pkg {
  name: string;
  dir: string;
  pnpmFilter: string;
  oxlintrc: string;
}

const packages: Pkg[] = [
  {
    name: "@tailor-platform/sdk",
    dir: "packages/sdk",
    pnpmFilter: "@tailor-platform/sdk",
    oxlintrc: "packages/sdk/.oxlintrc.json",
  },
  {
    name: "@tailor-platform/create-sdk",
    dir: "packages/create-sdk",
    pnpmFilter: "@tailor-platform/create-sdk",
    oxlintrc: "packages/create-sdk/.oxlintrc.json",
  },
  {
    name: "@tailor-platform/sdk-codemod",
    dir: "packages/sdk-codemod",
    pnpmFilter: "@tailor-platform/sdk-codemod",
    oxlintrc: "packages/sdk-codemod/.oxlintrc.json",
  },
  {
    name: "example",
    dir: "example",
    pnpmFilter: "example",
    oxlintrc: "example/.oxlintrc.json",
  },
];

type Severity = "off" | "warn" | "error";

function normaliseOxlintSeverity(value: unknown): Severity {
  const sev = Array.isArray(value) ? value[0] : value;
  if (sev === "off" || sev === "allow" || sev === 0) return "off";
  if (sev === "warn" || sev === 1) return "warn";
  return "error";
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

function pickLocalRules(rules: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(rules ?? {}).filter(([k]) => isLocalRule(k)));
}

function loadOxlintConfig(pkg: Pkg): OxlintConfig | null {
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

  resolved.rules = { ...(resolved.rules ?? {}), ...pickLocalRules(raw.rules) };
  // Match raw overrides by stringified `files`.
  const overrideKey = (o: { files: string[] }) => JSON.stringify(o.files);
  const byFiles = new Map<string, { files: string[]; rules?: Record<string, unknown> }>();
  for (const o of resolved.overrides ?? []) byFiles.set(overrideKey(o), o);
  for (const o of raw.overrides ?? []) {
    const localRules = pickLocalRules(o.rules);
    const target = byFiles.get(overrideKey(o));
    if (!target) {
      if (Object.keys(localRules).length > 0) {
        (resolved.overrides ??= []).push({ files: o.files, rules: localRules });
      }
      continue;
    }
    target.rules = { ...(target.rules ?? {}), ...localRules };
  }
  return resolved;
}

interface FileRuleMap {
  [rule: string]: Severity;
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

interface PackageReport {
  pkg: string;
  filesSampled: number;
  // Snapshot of every rule that resolves to a non-off severity in any sampled
  // file. Used to detect rules silently disappearing on oxlint upgrades.
  oxlintActiveRules: Set<string>;
}

function snapshotPackage(pkg: Pkg): PackageReport {
  const oxlintCfg = loadOxlintConfig(pkg);
  const compiledOxlint = oxlintCfg ? compileOxlintConfig(oxlintCfg) : null;
  const files = sampleFiles(listFiles(pkg));
  const report: PackageReport = {
    pkg: pkg.name,
    filesSampled: files.length,
    oxlintActiveRules: new Set(),
  };

  if (!compiledOxlint) return report;

  const pkgDirAbs = resolve(repoRoot, pkg.dir);
  for (const file of files) {
    const fileRelToPkg = relative(pkgDirAbs, resolve(repoRoot, file));
    const rules = resolveOxlintRulesForFile(compiledOxlint, fileRelToPkg);
    for (const [rule, sev] of Object.entries(rules)) {
      if (sev !== "off") report.oxlintActiveRules.add(rule);
    }
  }

  return report;
}

function printReport(report: PackageReport): void {
  console.log(`\n# ${report.pkg}  (sampled ${report.filesSampled} files)`);
  console.log(`  oxlint active rules: ${report.oxlintActiveRules.size}`);
}

function serialisableReport(report: PackageReport) {
  return {
    pkg: report.pkg,
    filesSampled: report.filesSampled,
    oxlintActiveRules: [...report.oxlintActiveRules].sort(),
  };
}

const args = process.argv.slice(2);
const writeJson = args.find((a) => a.startsWith("--json="))?.slice("--json=".length);
const onlyPackage = args.find((a) => a.startsWith("--pkg="))?.slice("--pkg=".length);
const compareBaselinePath = args.find((a) => a.startsWith("--check="))?.slice("--check=".length);

const reports: ReturnType<typeof serialisableReport>[] = [];
for (const pkg of packages) {
  if (onlyPackage && pkg.dir !== onlyPackage && pkg.name !== onlyPackage) continue;
  console.error(`\n# Snapshotting ${pkg.name} ...`);
  const report = snapshotPackage(pkg);
  printReport(report);
  reports.push(serialisableReport(report));
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
  console.log(`\n=== TOTAL oxlint rules dropped vs baseline: ${regressed} ===`);
}

process.exit(regressed > 0 ? 1 : 0);
