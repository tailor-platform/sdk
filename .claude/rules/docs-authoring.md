---
paths:
  - "packages/sdk/docs/**"
  - "packages/sdk/src/**/*.ts"
---

# User-Facing Docs Authoring

`packages/sdk/docs/**` ships inside the published npm package (`@tailor-platform/sdk`) and is read by **SDK users**. Write for that reader: document only what a user needs to use the SDK, not how the SDK or Platform is built. The same principle applies to JSDoc on **exported** symbols, which reaches users through editor tooltips.

## Write for the user, not the implementer

- Do **not** leak SDK/Platform internals: internal API / RPC / method / class names (e.g. `TestExecScript`), wire-format or transport terms the user never types (`proto` / `protobuf` / `gRPC` / `unary RPC`), internal module/layer structure (`parser` / `configure` / `types`), runtime-internal delegation, internal wrapping behavior, internal on-disk layout / ID-sanitization algorithms, and AST / code-injection internals.
- Describe behavior in terms of what the user does and observes, not the mechanism behind it.

## Keep "why" only when the user needs it

A reference to internal mechanics is fine when the reader must understand it to use the API correctly (e.g. the workflow deterministic-execution requirement, or why `migrate.ts` sees a particular schema state). Drop explanations that exist purely for internal convenience or naming.

## JSDoc is the single source of truth

Do not copy detailed API reference — full interface/type definitions or exhaustive field tables — into prose. Explain intent and let JSDoc / IDE autocompletion be the SSOT.

## No private references

Never link to or mention private/internal repositories or internal issue trackers (e.g. a `<org>/<private-repo>` link or an `<org>/<tracker>#NNN` reference) from published docs.

## Every page needs a `description`

Each page under `packages/sdk/docs/**` starts with a YAML frontmatter `description` that says what the user can do on the page. Docs tooling reads it for summaries such as the table of contents in `llms.txt`.

- Hand-written pages: put `description` in the page's own frontmatter.
- CLI pages: put `description` as a top-level key in the `.template.md`, next to the `politty` block. The generator keeps it and strips only `politty`.
- Migration guides: the description lives in `renderMigrationDoc` (`packages/sdk-codemod/src/migration-doc.ts`); do not edit `migration/v<major>.md` by hand.

## CLI docs are generated

`packages/sdk/docs/cli-reference.md` and `packages/sdk/docs/cli/*.md` are generated. Change them through their templates or command definitions as the "CLI Documentation" section of `AGENTS.md` describes.

## Keep this rule and the CI check in sync

The same principles are enforced in CI by `.github/workflows/docs-consistency-check.yml` (the "Reader-Perspective Review" section of its prompt). When you change the guidance here, update that workflow to match — and vice versa — so the rule humans read and the check CI runs do not drift apart.
