#!/usr/bin/env node
// Determines whether a push/PR is relevant to an ERD namespace, and emits
// the compare's fork point for reuse by erd-find-base-run.mjs.
//
// "Relevant" means the diff between SHA_BASE and SHA_HEAD touches either
// tailor.config.ts, the erd viewer implementation itself, or a directory
// this namespace's export actually loaded from (per LOG_FILE's "loaded
// from ..." lines) — never a copy of tailor.config.ts's `files` globs, so
// this always matches the live config. A full (300-entry) page of compare
// files is treated as possibly truncated, and kept relevant unconditionally,
// since the API gives no total count to detect truncation by.
import { readFileSync, appendFileSync } from "node:fs";

export const ALWAYS_RELEVANT = [
  /^example\/tailor\.config\.ts$/,
  /^packages\/sdk\/src\/cli\/commands\/tailordb\/erd\//,
];

export const ZERO_SHA = "0".repeat(40);

export function loadedNamespaceDirs(logContent) {
  return [...new Set([...logContent.matchAll(/loaded from ([^/]+)\//g)].map((m) => m[1]))];
}

/**
 * @param {object} params
 * @param {string} params.shaBase
 * @param {string} params.shaHead
 * @param {string} params.logContent - contents of the export log, or "" if it doesn't exist
 * @param {(base: string, head: string) => Promise<{ files?: { filename: string }[], merge_base_commit: { sha: string } }>} params.compareCommits
 * @returns {Promise<{ relevant: boolean, forkSha?: string, reason: string }>}
 */
export async function determineRelevance({ shaBase, shaHead, logContent, compareCommits }) {
  if (shaBase === ZERO_SHA) {
    return { relevant: true, reason: "No previous commit to diff against; keeping this export." };
  }

  const compare = await compareCommits(shaBase, shaHead);
  const forkSha = compare.merge_base_commit.sha;

  const files = compare.files ?? [];
  if (files.length >= 300) {
    return {
      relevant: true,
      forkSha,
      reason:
        "Compare API file list may be truncated at 300 entries; keeping this export to be safe.",
    };
  }

  const changedFiles = files.map((f) => f.filename);

  if (changedFiles.some((f) => ALWAYS_RELEVANT.some((re) => re.test(f)))) {
    return {
      relevant: true,
      forkSha,
      reason: "Relevant config or viewer implementation change detected; keeping this export.",
    };
  }

  const namespaceDirs = loadedNamespaceDirs(logContent);
  if (namespaceDirs.length === 0) {
    return {
      relevant: true,
      forkSha,
      reason: "No type files were loaded; keeping the export as-is.",
    };
  }

  const relevant = namespaceDirs.some((dir) =>
    changedFiles.some((f) => f.startsWith(`example/${dir}/`)),
  );
  return {
    relevant,
    forkSha,
    reason: relevant ? "Relevant files changed." : "No relevant files changed; skipping.",
  };
}

async function main() {
  const { GH_TOKEN, REPO, SHA_BASE, SHA_HEAD, LOG_FILE, GITHUB_OUTPUT } = process.env;

  function setOutput(name, value) {
    if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `${name}=${value}\n`);
  }

  async function compareCommits(base, head) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/compare/${base}...${head}`, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      throw new Error(`compare ${base}...${head} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  let logContent = "";
  try {
    logContent = readFileSync(LOG_FILE, "utf8");
  } catch {
    // no log; treated as no resolved type dirs
  }

  const { relevant, forkSha, reason } = await determineRelevance({
    shaBase: SHA_BASE,
    shaHead: SHA_HEAD,
    logContent,
    compareCommits,
  });

  console.log(reason);
  if (forkSha) setOutput("fork_sha", forkSha);
  setOutput("relevant", String(relevant));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
