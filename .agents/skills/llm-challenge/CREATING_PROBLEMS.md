# Creating Problems

Create only prompt/scaffold problems:

```text
llm-challenge/problems/<group>/<id>/
  meta.json
  prompt.md
  verify.json       # optional visible minimum-correctness checks
  scaffold/
```

Rules:

- `group` is `sdk-api` or `cli` and comes from the directory, not `meta.json`.
- `id` is short kebab-case. If the user does not provide it, propose one and verify it is unique across all groups.
- `meta.json` contains only `id` and `title`; `id` must match the directory name.
- `verify.json`, when present, contains visible minimum-correctness checks only. Checks should encode conditions where missing evidence is definitely wrong, similar to type checking; do not put ideal implementations, hidden answers, scores, or broad quality judgments there.
- Write `prompt.md` in English.
- For `sdk-api`, do not include SDK API names, imports, code examples, or direct solution hints.
- For `cli`, the prompt may name the `tailor-sdk` binary, but must not name the target subcommand or exact arguments.
- Keep `scaffold/` minimal and runnable enough for the task. Do not add `solution/`, evaluator tests, scoring metadata, or hidden hints.

Validate discovery and focused behavior with narrow tests or a targeted dry run when practical.
