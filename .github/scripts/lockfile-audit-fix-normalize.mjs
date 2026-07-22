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
// Finally, it drops minimumReleaseAgeExclude entries that have outlived
// their purpose: once a pinned version is older than minimumReleaseAge on
// its own, the bypass is a no-op and nothing (Renovate included) ever
// removes it, so the list only grows over time unless swept here.

import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] || "pnpm-workspace.yaml";
const REQUIRED_COMMENT = /^#\s*Renovate security update\s*:/i;

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
