#!/usr/bin/env node
// Post-processes pnpm-workspace.yaml after `pnpm audit --fix` (update and/or
// override mode) has run.
//
// A package with multiple advisories at different patched-version
// thresholds (e.g. fast-uri/GHSA-v2hh-gcrm-f6hx, fixed in 3.1.4, on top of
// GHSA-4c8g-83qw-93j6, fixed in 3.1.3) makes `pnpm audit --fix` add more
// than one overlapping entry for the same package to `overrides` and/or
// `minimumReleaseAgeExclude`. Overlapping ranges there make the following
// `pnpm install` hard-fail with ERR_PNPM_NO_MATURE_MATCHING_VERSION instead
// of resolving to the fully-patched version. This collapses each package
// down to its single highest-version entry in both lists.
//
// It also inserts the `# Renovate security update: <entry>` comment that
// renovate-policy-check.mjs requires above every version-pinned
// minimumReleaseAgeExclude entry — `pnpm audit --fix` adds entries with no
// comment at all.
//
// Finally, it drops entries that have outlived their purpose. Nothing else,
// Renovate included, ever removes either kind, so both lists only grow over
// time unless swept here:
//
//   - minimumReleaseAgeExclude: once a pinned version is older than
//     minimumReleaseAge on its own, the bypass is a no-op.
//   - overrides: once nothing in the dependency tree resolves to the
//     overridden package, the pin protects nothing — but Renovate still
//     treats the right-hand side as a live dependency and keeps filing no-op
//     bump PRs against it (seen with fast-uri, orphaned once ajv 8 left the
//     tree). Mark an override that intentionally pins a package the tree
//     does not contain yet with a `# keep-override: <reason>` comment.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const path = process.argv[2] || "pnpm-workspace.yaml";
const lockfilePath = process.argv[3] || join(dirname(path), "pnpm-lock.yaml");
const REQUIRED_COMMENT = /^#\s*Renovate security update\s*:/i;
const KEEP_OVERRIDE_COMMENT = /^#\s*keep-override\s*:/i;

function splitNameSpec(entry) {
  const at = entry.startsWith("@") ? entry.indexOf("@", 1) : entry.indexOf("@");
  if (at === -1) return [entry, null];
  return [entry.slice(0, at), entry.slice(at + 1)];
}

function parseVer(v) {
  const m = String(v).match(/(\d+)\.(\d+)\.(\d+)/);
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

function quoteIfNeeded(entry) {
  return entry.startsWith("@") ? `"${entry}"` : entry;
}

function findBlock(lines, key) {
  const startIdx = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return { startIdx, endIdx };
}

function normalizeExclude(lines) {
  const block = findBlock(lines, "minimumReleaseAgeExclude");
  if (!block) return lines;
  const { startIdx, endIdx } = block;
  const body = lines.slice(startIdx + 1, endIdx);

  const items = [];
  let pendingComment = null;
  for (const raw of body) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      pendingComment = null;
      continue;
    }
    if (trimmed.startsWith("#")) {
      pendingComment = raw;
      continue;
    }
    const m = trimmed.match(/^-\s*"?([^"]+?)"?\s*$/);
    if (!m) {
      pendingComment = null;
      continue;
    }
    items.push({ comment: pendingComment, entry: m[1].trim() });
    pendingComment = null;
  }

  const byPkg = new Map();
  const order = [];
  for (const item of items) {
    const [pkg, version] = splitNameSpec(item.entry);
    if (version && parseVer(version)) {
      const existing = byPkg.get(pkg);
      if (!existing || verGt(version, existing.version)) {
        byPkg.set(pkg, { entry: item.entry, comment: item.comment, version });
      }
      if (!order.some((o) => o.type === "pkg" && o.pkg === pkg)) {
        order.push({ type: "pkg", pkg });
      }
    } else {
      order.push({ type: "raw", item });
    }
  }

  const newBody = [];
  for (const o of order) {
    if (o.type === "raw") {
      if (o.item.comment) newBody.push(o.item.comment);
      newBody.push(`  - ${quoteIfNeeded(o.item.entry)}`);
    } else {
      const winner = byPkg.get(o.pkg);
      const comment =
        winner.comment && REQUIRED_COMMENT.test(winner.comment.trim())
          ? winner.comment
          : `  # Renovate security update: ${winner.entry}`;
      newBody.push(comment);
      newBody.push(`  - ${winner.entry}`);
    }
  }

  if (body.length > 0 && body.at(-1).trim() === "") newBody.push("");
  return [...lines.slice(0, startIdx + 1), ...newBody, ...lines.slice(endIdx)];
}

function normalizeOverrides(lines) {
  const block = findBlock(lines, "overrides");
  if (!block) return lines;
  const { startIdx, endIdx } = block;
  const body = lines.slice(startIdx + 1, endIdx);

  const items = body.map((raw) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return { raw, passthrough: true };
    const idx = trimmed.indexOf(":");
    if (idx === -1) return { raw, passthrough: true };
    return { raw, key: trimmed.slice(0, idx).trim(), value: trimmed.slice(idx + 1).trim() };
  });

  const byPkg = new Map();
  const order = [];
  for (const item of items) {
    if (item.passthrough) {
      order.push({ type: "raw", item });
      continue;
    }
    const [pkg] = splitNameSpec(item.key);
    const versionMatch = item.value.match(/(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : null;
    if (version) {
      const existing = byPkg.get(pkg);
      if (!existing || verGt(version, existing.version)) {
        byPkg.set(pkg, { ...item, version });
      }
      if (!order.some((o) => o.type === "pkg" && o.pkg === pkg)) {
        order.push({ type: "pkg", pkg });
      }
    } else {
      order.push({ type: "raw", item });
    }
  }

  const newBody = order.map((o) => (o.type === "raw" ? o.item.raw : byPkg.get(o.pkg).raw));
  return [...lines.slice(0, startIdx + 1), ...newBody, ...lines.slice(endIdx)];
}

// pnpm's dep-path syntax (`parent>child`) and range operators (`>=3.0.0`)
// share the `>` character, so read only the leading package name. For
// `parent>child` that resolves to the parent, which is the right target
// anyway: an override keyed on a parent that has left the tree is dead too.
const OVERRIDE_TARGET = /^(?:@[^/@\s>]+\/)?[^@\s>]+/;

function overrideTargetName(key) {
  const match = key.match(OVERRIDE_TARGET);
  return match ? match[0] : null;
}

// The lockfile mirrors pnpm-workspace.yaml's `overrides` in a top-level
// `overrides:` block of its own, so scanning the file whole would report every
// override as live off the back of its own entry. That block has to come out
// before anything else is read.
function readLockfileOutsideOverrides(lockPath) {
  let lines;
  try {
    lines = readFileSync(lockPath, "utf8").split("\n");
  } catch {
    return null;
  }
  if (!findBlock(lines, "packages")) return null;
  const overrides = findBlock(lines, "overrides");
  if (!overrides) return lines.join("\n");
  return [...lines.slice(0, overrides.startIdx), ...lines.slice(overrides.endIdx)].join("\n");
}

// Any mention counts as present — importer specifiers, resolved
// `name@version` keys and peer-dependency suffixes alike — so this only ever
// errs toward keeping an override. The leading boundary is what stops a `uri`
// override from matching `fast-uri@3.1.4`.
function isMentioned(haystack, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zA-Z0-9@._/-])${escaped}@`, "m").test(haystack);
}

function pruneOrphanedOverrides(lines, lockPath) {
  const block = findBlock(lines, "overrides");
  if (!block) return lines;

  const lockfile = readLockfileOutsideOverrides(lockPath);
  if (lockfile === null) {
    console.log(`Could not read the dependency tree from "${lockPath}"; keeping every override.`);
    return lines;
  }

  const { startIdx, endIdx } = block;
  const body = lines.slice(startIdx + 1, endIdx);

  const kept = [];
  let comments = [];
  for (const raw of body) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      kept.push(...comments, raw);
      comments = [];
      continue;
    }
    if (trimmed.startsWith("#")) {
      comments.push(raw);
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      kept.push(...comments, raw);
      comments = [];
      continue;
    }

    // Unquoted so the reported entry stays parseable by the workflow that
    // turns these log lines into the PR body.
    const key = trimmed
      .slice(0, colon)
      .trim()
      .replace(/^["']|["']$/g, "");
    const name = overrideTargetName(key);
    const optedOut = comments.some((c) => KEEP_OVERRIDE_COMMENT.test(c.trim()));

    if (name && !optedOut && !isMentioned(lockfile, name)) {
      console.log(
        `Dropping orphaned override entry "${key}" (${name} is not in the dependency tree).`,
      );
      comments = [];
      continue;
    }

    kept.push(...comments, raw);
    comments = [];
  }
  kept.push(...comments);

  return [...lines.slice(0, startIdx + 1), ...kept, ...lines.slice(endIdx)];
}

function getMinimumReleaseAgeMinutes(lines) {
  const line = lines.find((l) => /^minimumReleaseAge\s*:/.test(l));
  const m = line && line.match(/^minimumReleaseAge\s*:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

async function fetchPublishedAt(pkg, version) {
  const parts = pkg.split("/");
  const encoded = pkg.startsWith("@") ? `@${parts[0].slice(1)}%2F${parts[1]}` : pkg;
  const res = await fetch(`https://registry.npmjs.org/${encoded}`);
  if (!res.ok) return null;
  const data = await res.json();
  const t = data.time?.[version];
  return t ? new Date(t) : null;
}

async function pruneStaleExcludes(lines, minimumReleaseAgeMinutes) {
  if (minimumReleaseAgeMinutes == null) return lines;
  const block = findBlock(lines, "minimumReleaseAgeExclude");
  if (!block) return lines;
  const { startIdx, endIdx } = block;
  const body = lines.slice(startIdx + 1, endIdx);

  const items = [];
  let pendingComment = null;
  for (const raw of body) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      pendingComment = null;
      continue;
    }
    if (trimmed.startsWith("#")) {
      pendingComment = raw;
      continue;
    }
    const m = trimmed.match(/^-\s*"?([^"]+?)"?\s*$/);
    if (!m) {
      pendingComment = null;
      continue;
    }
    items.push({ comment: pendingComment, entry: m[1].trim() });
    pendingComment = null;
  }

  const kept = [];
  for (const item of items) {
    const [pkg, version] = splitNameSpec(item.entry);
    if (!version || !parseVer(version)) {
      kept.push(item);
      continue;
    }
    try {
      const publishedAt = await fetchPublishedAt(pkg, version);
      if (!publishedAt) {
        kept.push(item); // unknown publish time — keep, conservatively
        continue;
      }
      const ageMinutes = (Date.now() - publishedAt.getTime()) / 60_000;
      if (ageMinutes >= minimumReleaseAgeMinutes) {
        console.log(
          `Dropping stale exclude entry "${item.entry}" (published ${Math.floor(ageMinutes / 1440)}d ago).`,
        );
        continue; // now mature on its own — the bypass is a no-op
      }
      kept.push(item);
    } catch (err) {
      console.log(`Could not check publish time for "${item.entry}" (${err.message}); keeping it.`);
      kept.push(item);
    }
  }

  const newBody = [];
  for (const item of kept) {
    if (item.comment) newBody.push(item.comment);
    newBody.push(`  - ${quoteIfNeeded(item.entry)}`);
  }
  if (body.length > 0 && body.at(-1).trim() === "") newBody.push("");
  return [...lines.slice(0, startIdx + 1), ...newBody, ...lines.slice(endIdx)];
}

async function main() {
  const original = readFileSync(path, "utf8");
  let lines = original.split("\n");
  lines = normalizeExclude(lines);
  lines = normalizeOverrides(lines);
  lines = pruneOrphanedOverrides(lines, lockfilePath);
  const minimumReleaseAgeMinutes = getMinimumReleaseAgeMinutes(lines);
  lines = await pruneStaleExcludes(lines, minimumReleaseAgeMinutes);
  const result = lines.join("\n");

  if (result !== original) {
    writeFileSync(path, result);
    console.log(`Normalized ${path}.`);
  } else {
    console.log(`${path} already normalized; no changes.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
