import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { stripJsdoc } from "../variants/strip-jsdoc.ts";
import { packageDocsRoot } from "../variants/resolve.ts";
import type { DocsCondition } from "../types.ts";

const ENTRY_DTS_CANDIDATES = [
  "configure/index.d.mts",
  "configure/index.d.ts",
  "index.d.mts",
  "index.d.ts",
];

async function readEntryDts(variantDist: string): Promise<{ path: string; content: string }> {
  for (const c of ENTRY_DTS_CANDIDATES) {
    const full = join(variantDist, c);
    if (existsSync(full)) {
      return { path: full, content: await readFile(full, "utf8") };
    }
  }
  throw new Error(`No entry .d.ts found under ${variantDist}`);
}

async function listMarkdown(dir: string, depth = 2): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  async function walk(d: string, level: number): Promise<void> {
    if (level < 0) return;
    let entries: string[] = [];
    try {
      entries = await readdir(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e);
      const { stat } = await import("node:fs/promises");
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await walk(full, level - 1);
        continue;
      }
      if (e.toLowerCase().endsWith(".md")) out.push(full);
    }
  }
  await walk(dir, depth);
  return out.sort();
}

async function readFileMaybe(p: string): Promise<string | null> {
  if (!existsSync(p)) return null;
  return readFile(p, "utf8");
}

async function loadPackageDocs(variantDist: string): Promise<string | null> {
  const packageRoot = packageDocsRoot(variantDist);
  const parts: string[] = [];

  const readme = await readFileMaybe(join(packageRoot, "README.md"));
  if (readme) parts.push(`### README.md\n${readme}`);

  const docsDir = join(packageRoot, "docs");
  const mds = await listMarkdown(docsDir, 2);
  for (const md of mds) {
    const content = await readFileMaybe(md);
    if (content) {
      const rel = md.slice(packageRoot.length + 1);
      parts.push(`### ${rel}\n${content}`);
    }
  }
  if (parts.length === 0) return null;
  return `## Package documentation\n\n${parts.join("\n\n")}`;
}

async function loadAgentFiles(variantDist: string): Promise<string | null> {
  const packageRoot = packageDocsRoot(variantDist);
  const candidates = [
    join(packageRoot, "AGENTS.md"),
    join(packageRoot, "skills", "tailor-sdk", "SKILL.md"),
    join(packageRoot, "CLAUDE.md"),
  ];
  const parts: string[] = [];
  for (const c of candidates) {
    const text = await readFileMaybe(c);
    if (text) {
      const name = c.slice(packageRoot.length + 1);
      parts.push(`### ${name}\n${text}`);
    }
  }
  if (parts.length === 0) return null;
  return `## Agent guidance\n\n${parts.join("\n\n")}`;
}

async function fetchExternalDocs(): Promise<string | null> {
  // L5 — docs.tailor.tech. Network access not assumed in default runs.
  // Override by setting LLM_EVAL_EXTERNAL_DOCS to a local file path.
  const override = process.env.LLM_EVAL_EXTERNAL_DOCS;
  if (override) return readFileMaybe(override);
  return null;
}

async function fetchLlmsTxt(): Promise<string | null> {
  const override = process.env.LLM_EVAL_LLMS_TXT;
  if (override) return readFileMaybe(override);
  return null;
}

export type DocsContextSection = {
  layer: "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
  title: string;
  body: string;
};

export type DocsContext = {
  text: string;
  sections: DocsContextSection[];
};

export async function buildDocsContext(
  condition: DocsCondition,
  variantDist: string,
): Promise<DocsContext> {
  const sections: DocsContextSection[] = [];

  if (condition.preset !== "predicted") {
    const { content } = await readEntryDts(variantDist);
    const body = condition.jsdoc ? content : stripJsdoc(content);
    sections.push({
      layer: condition.jsdoc ? "L2" : "L1",
      title: "Type signatures",
      body: "```ts\n" + body + "\n```",
    });
  }

  if (condition.packageDocs) {
    const docs = await loadPackageDocs(variantDist);
    if (docs) sections.push({ layer: "L3", title: "Package docs", body: docs });
  }
  if (condition.agentFiles) {
    const agents = await loadAgentFiles(variantDist);
    if (agents) sections.push({ layer: "L4", title: "Agent guidance", body: agents });
  }
  if (condition.externalDocs) {
    const ext = await fetchExternalDocs();
    if (ext) sections.push({ layer: "L5", title: "External docs", body: ext });
  }
  if (condition.llmsTxt) {
    const lt = await fetchLlmsTxt();
    if (lt) sections.push({ layer: "L6", title: "llms.txt", body: lt });
  }

  const text = sections.map((s) => `## [${s.layer}] ${s.title}\n\n${s.body}`).join("\n\n---\n\n");
  return { text, sections };
}
