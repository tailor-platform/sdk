#!/usr/bin/env node
// Upserts (or removes) the PR's sticky ERD preview comment based on this
// run's uploaded viewer artifacts. Every namespace can be skipped as
// irrelevant to the PR (see erd-relevance.mjs), so an empty artifact list
// removes any stale comment instead of posting an empty one.
export const MARKER = "<!-- erd-viewer-preview -->";

/**
 * @param {object} params
 * @param {{ name: string, id: number }[]} params.artifacts - already filtered to *.html and sorted by name
 * @param {string} params.baseRef
 * @param {string} params.serverUrl
 * @param {string} params.repo
 * @param {number|string} params.runId
 */
export function buildCommentBody({ artifacts, baseRef, serverUrl, repo, runId }) {
  let body = `${MARKER}\n### 🗺️ ERD viewer preview\n\n`;
  body += `Self-contained ERD viewer HTML built for this run. Each viewer can switch between the current schema and a diff against base branch \`${baseRef}\`:\n`;
  for (const { name, id } of artifacts) {
    const ns = name.replace(/\.html$/, "");
    body += `\n- **${ns} viewer**: [${name}](${serverUrl}/${repo}/actions/runs/${runId}/artifacts/${id})`;
  }
  return body;
}

/**
 * @param {object} params
 * @param {{ name: string, id: number }[]} params.artifacts
 * @param {{ id: number, body: string } | undefined} params.existingComment
 * @param {(body: string) => Promise<void>} params.postComment
 * @param {(id: number, body: string) => Promise<void>} params.patchComment
 * @param {(id: number) => Promise<void>} params.deleteComment
 * @param {(body: string) => string} params.buildBody
 * @returns {Promise<string>} what happened, for logging
 */
export async function upsertPreviewComment({
  artifacts,
  existingComment,
  postComment,
  patchComment,
  deleteComment,
  buildBody,
}) {
  if (artifacts.length === 0) {
    if (existingComment) {
      await deleteComment(existingComment.id);
      return `Removed stale sticky comment ${existingComment.id}`;
    }
    return "No ERD preview artifacts in this run; nothing to post.";
  }

  const body = buildBody();
  if (existingComment) {
    await patchComment(existingComment.id, body);
    return `Updated sticky comment ${existingComment.id}`;
  }
  await postComment(body);
  return "Created sticky comment";
}

async function main() {
  const { GH_TOKEN, REPO, RUN_ID, SERVER_URL, PR_NUMBER, BASE_REF } = process.env;

  async function githubApi(path, options = {}) {
    const res = await fetch(`https://api.github.com/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(
        `${options.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`,
      );
    }
    return res.status === 204 ? null : res.json();
  }

  async function paginate(path, extract) {
    const items = [];
    for (let page = 1; ; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const batch = await githubApi(`${path}${sep}per_page=100&page=${page}`);
      const list = extract(batch);
      items.push(...list);
      if (list.length < 100) break;
    }
    return items;
  }

  const artifacts = (
    await paginate(`repos/${REPO}/actions/runs/${RUN_ID}/artifacts`, (b) => b.artifacts)
  )
    .filter((a) => a.name.endsWith(".html"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const comments = await paginate(`repos/${REPO}/issues/${PR_NUMBER}/comments`, (b) => b);
  const existingComment = comments.find((c) => c.body.includes(MARKER));

  const message = await upsertPreviewComment({
    artifacts,
    existingComment,
    buildBody: () =>
      buildCommentBody({
        artifacts,
        baseRef: BASE_REF,
        serverUrl: SERVER_URL,
        repo: REPO,
        runId: RUN_ID,
      }),
    postComment: (body) =>
      githubApi(`repos/${REPO}/issues/${PR_NUMBER}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    patchComment: (id, body) =>
      githubApi(`repos/${REPO}/issues/comments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      }),
    deleteComment: (id) => githubApi(`repos/${REPO}/issues/comments/${id}`, { method: "DELETE" }),
  });

  console.log(message);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
