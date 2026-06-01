#!/usr/bin/env node
// Static checks for our Renovate policy hygiene.
//
// 1. Detects stale `allowedVersions` block rules in renovate.json: when
//    the currently pinned version has moved past every explicitly blocked
//    version, the rule no longer protects anything and should be removed.
//
// 2. Validates pnpm-workspace.yaml `minimumReleaseAgeExclude` entries:
//    every version-pinned entry (e.g. `turbo@2.9.14`) must be preceded by
//    a `# Renovate security update: ...` comment justifying the bypass.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.env.GITHUB_WORKSPACE || process.cwd();
const errors = [];
const warnings = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listFilesRecursive(dir, predicate) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (
        e.name === "node_modules" ||
        e.name === ".git" ||
        e.name === "dist" ||
        e.name === ".turbo" ||
        e.name === ".next"
      ) {
        continue;
      }
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (predicate(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function parseVer(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function verGt(a, b) {
  const pa = parseVer(a);
  const pb = parseVer(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

function verMax(vs) {
  let best = vs[0];
  for (const v of vs) {
    if (verGt(v, best)) best = v;
  }
  return best;
}

// Extract versions the expression *explicitly* blocks. Supports the
// patterns we actually use in renovate.json:
//   - `<X.Y.Z || >X.Y.Z`  (skip exactly X.Y.Z)
//   - `>X.Y.Z || <X.Y.Z`  (same, reversed)
//   - `!/^X\.Y\.Z$/`       (Renovate regex form)
// Open-ended ranges like `<=X.Y.Z` block infinitely many versions and
// cannot be "outgrown", so we report them as warnings instead.
function findExplicitlyBlockedVersions(expr) {
  const blocked = new Set();

  const orPattern =
    /(<|>)\s*(\d+\.\d+\.\d+(?:-[\w.+-]+)?)\s*\|\|\s*(<|>)\s*(\d+\.\d+\.\d+(?:-[\w.+-]+)?)/g;
  for (const m of expr.matchAll(orPattern)) {
    if (m[1] !== m[3] && m[2] === m[4]) blocked.add(m[2]);
  }

  const regexPattern = /!\/\^([\d\\.]+)\$\//g;
  for (const m of expr.matchAll(regexPattern)) {
    const v = m[1].replace(/\\\./g, ".");
    if (/^\d+\.\d+\.\d+$/.test(v)) blocked.add(v);
  }

  return [...blocked];
}

function findGithubActionsPin(pkgName) {
  const files = listFilesRecursive(REPO_ROOT, (p) => /\.ya?ml$/.test(p));
  const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `uses:\\s+${escaped}(?:/[^\\s@]+)?@[a-f0-9]+\\s*#\\s*v?(\\d+\\.\\d+\\.\\d+(?:-[\\w.+-]+)?)`,
    "g",
  );
  const found = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(re)) {
      found.push({ file: relative(REPO_ROOT, file), version: m[1] });
    }
  }
  return found;
}

function findNpmPin(pkgName) {
  const files = listFilesRecursive(
    REPO_ROOT,
    (p) => p.endsWith("/package.json") || p === join(REPO_ROOT, "package.json"),
  );
  const found = [];
  for (const file of files) {
    let pkg;
    try {
      pkg = readJson(file);
    } catch {
      continue;
    }
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const deps = pkg[section];
      if (!deps || !deps[pkgName]) continue;
      const raw = String(deps[pkgName]).replace(/^[\^~]/, "");
      if (parseVer(raw)) {
        found.push({ file: relative(REPO_ROOT, file), version: raw });
      }
    }
  }
  return found;
}

// ===== Check 1: stale allowedVersions block rules =====
const renovate = readJson(join(REPO_ROOT, "renovate.json"));
for (const rule of renovate.packageRules || []) {
  if (!rule.allowedVersions || !Array.isArray(rule.matchPackageNames)) continue;

  const exactPackages = rule.matchPackageNames.filter((p) => !p.includes("*"));
  if (exactPackages.length === 0) continue;

  const blocked = findExplicitlyBlockedVersions(rule.allowedVersions);
  if (blocked.length === 0) {
    warnings.push(
      `Rule for ${exactPackages.join(", ")} (allowedVersions: "${rule.allowedVersions}") is open-ended; staleness cannot be checked automatically. Use the "<X.Y.Z || >X.Y.Z" form to enable checks.`,
    );
    continue;
  }

  const maxBlocked = verMax(blocked);

  for (const pkg of exactPackages) {
    const isAction = !pkg.startsWith("@") && /^[\w-]+\/[\w.-]+$/.test(pkg);
    const usages = isAction ? findGithubActionsPin(pkg) : findNpmPin(pkg);

    if (usages.length === 0) {
      warnings.push(
        `Rule for ${pkg} (allowedVersions: "${rule.allowedVersions}"): no pinned usage found; the rule may be orphaned.`,
      );
      continue;
    }

    for (const u of usages) {
      if (verGt(u.version, maxBlocked)) {
        errors.push(
          `Stale Renovate rule: ${pkg} is pinned at ${u.version} in ${u.file}, which is newer than the blocked version ${maxBlocked} (allowedVersions: "${rule.allowedVersions}"). Remove this packageRule from renovate.json.`,
        );
      }
    }
  }
}

// ===== Check 2: minimumReleaseAgeExclude justification =====
const workspaceText = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
const lines = workspaceText.split("\n");

let inExclude = false;
let pendingComment = null;
for (const raw of lines) {
  const trimmed = raw.trim();

  if (/^minimumReleaseAgeExclude\s*:/.test(raw)) {
    inExclude = true;
    pendingComment = null;
    continue;
  }

  if (!inExclude) continue;

  if (/^\S/.test(raw)) {
    inExclude = false;
    continue;
  }

  if (trimmed === "") {
    pendingComment = null;
    continue;
  }

  if (trimmed.startsWith("#")) {
    pendingComment = trimmed;
    continue;
  }

  const m = trimmed.match(/^-\s*"?([^"]+?)"?\s*$/);
  if (m) {
    const entry = m[1].trim();
    const versionPinned = /@\d/.test(entry);
    if (versionPinned) {
      const justified = pendingComment && /^#\s*Renovate security update\s*:/i.test(pendingComment);
      if (!justified) {
        errors.push(
          `pnpm-workspace.yaml: minimumReleaseAgeExclude entry "${entry}" must be preceded by a "# Renovate security update: ..." comment justifying the bypass.`,
        );
      }
    }
    pendingComment = null;
  }
}

// ===== Report =====
if (warnings.length > 0) {
  console.log("Warnings:");
  for (const w of warnings) console.log(`  - ${w}`);
  console.log("");
}
if (errors.length > 0) {
  console.log("Errors:");
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log("Renovate policy checks passed.");
