---
name: docs-check
description: >
  Search and retrieve Tailor Platform documentation from docs.tailor.tech.
  Use this skill whenever working with platform services -- even when the codebase
  seems to have the answer. SDK code shows implementation details, but the official
  docs describe authoritative platform behavior, configuration options, and constraints
  that may not be apparent from code alone.
  Covers: TailorDB, Auth, Executor, Function, Workflow, Resolver, Secret Manager,
  Static Website, AppShell, TRN format, platform limits, and more.
  Also use during planning phases when platform capabilities or limitations need clarification.
metadata:
  internal: true
---

# Tailor Platform Docs Search

Search https://docs.tailor.tech/ to find and summarize platform specifications relevant to the current task.

## When to use

- Checking how a platform service behaves (permissions, hooks, triggers, fields, etc.)
- Looking up API details, configuration options, or platform limits
- Clarifying platform-side constraints during planning or implementation
- Verifying assumptions about service behavior before writing code

## Search strategy

Use a two-step approach: discover relevant pages, then fetch their content.

### Step 1: Discover pages

**Option A -- hashmap lookup** (preferred when you know the topic area):

Fetch `https://docs.tailor.tech/hashmap.json` to get the complete page index. Keys are paths like `guides_tailordb_permission.md`. Convert to URLs by replacing `_` with `/` and dropping `.md`:

`guides_tailordb_permission.md` -> `https://docs.tailor.tech/guides/tailordb/permission`

Filter keys by relevant keywords to find candidate pages.

**Option B -- web search** (when the topic is broad or unclear):

Use WebSearch with `site:docs.tailor.tech <query>` to find relevant pages via Google.

Use both options in parallel when unsure which will yield better results.

### Step 2: Fetch and summarize

Use WebFetch on the most relevant pages (usually 1-3). Extract:

1. The specific specification or behavior the user needs
2. Code examples if available
3. Constraints, limits, or gotchas

## Output format

- **Source URLs** -- always include so the user can read the full page
- **Relevant specs** -- concise summary focused on what matters for the current task
- **Code examples** -- include when they exist and are relevant
- **Caveats** -- note any limits, edge cases, or non-obvious behavior

Keep the output focused. Do not dump entire pages -- extract only what is relevant to the question at hand.
