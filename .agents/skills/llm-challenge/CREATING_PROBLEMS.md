# Creating Problems

Create only prompt/scaffold problems:

```text
llm-challenge/problems/<group>/<id>/
  meta.json
  prompt.md
  verify.json       # optional visible minimum-correctness checks
  rubric.json       # hidden grading claims for `challenge grade`
  scaffold/
```

Rules:

- `group` is `sdk-api` or `cli` and comes from the directory, not `meta.json`.
- `id` is short kebab-case. If the user does not provide it, propose one and verify it is unique across all groups.
- `meta.json` contains only `id` and `title`; `id` must match the directory name.
- `verify.json`, when present, contains visible minimum-correctness checks only. Checks should encode conditions where missing evidence is definitely wrong, similar to type checking; do not put ideal implementations, hidden answers, scores, or broad quality judgments there.
- Write `prompt.md` in English.
- For `sdk-api`, do not include SDK API names, imports, code examples, or direct solution hints.
- For `cli`, the prompt may name the `tailor` binary, but must not name the target subcommand or exact arguments.
- `rubric.json` contains `{ "schemaVersion": 1, "claims": [{ "id", "claim" }] }` with kebab-case ids. Write each claim as one concrete, checkable statement about the final workspace or command history (for example the exact SDK call, field option, or file that must exist), name every acceptable alternative, and keep claims independent so one failure does not cascade. Verify every SDK fact a claim states against `packages/sdk/docs/` or `packages/sdk/src/` before adding it. Claims are hidden from the solver: only `scaffold/` and `prompt.md` reach the workspace.
- Keep `scaffold/` minimal and runnable enough for the task. Do not add `solution/`, evaluator tests, weights or point values, or hidden hints in the scaffold or prompt.

Validate discovery and focused behavior with narrow tests or a targeted dry run when practical.
