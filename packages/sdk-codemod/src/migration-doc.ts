import type { CodemodPackage } from "./types";

export type AutomationLevel = "Automatic" | "Partially automatic" | "Manual";

/**
 * Classify how much of a migration the codemod automates.
 * - `Automatic`: a transform fully covers it, with no residual to flag.
 * - `Partially automatic`: a transform covers the common cases but flags
 *   residuals (via `legacyPatterns`/`suspiciousPatterns`/`prompt`) to finish.
 * - `Manual`: no transform; the change is migrated by hand (optionally guided
 *   by a `prompt`). Whether a person or an LLM does it does not matter here.
 * @param codemod - The codemod registry entry
 * @returns The automation level
 */
export function automationLevel(codemod: CodemodPackage): AutomationLevel {
  if (!codemod.scriptPath) return "Manual";
  const flagsResidual =
    (codemod.legacyPatterns?.length ?? 0) > 0 ||
    (codemod.suspiciousPatterns?.length ?? 0) > 0 ||
    codemod.prompt != null;
  return flagsResidual ? "Partially automatic" : "Automatic";
}

function renderEntry(codemod: CodemodPackage): string {
  const level = automationLevel(codemod);
  const lines: string[] = [`## ${codemod.name}`, "", `**Migration:** ${level}`, ""];
  lines.push(codemod.description, "");

  for (const example of codemod.examples ?? []) {
    const fence = "```" + (example.lang ?? "ts");
    if (example.caption) lines.push(example.caption, "");
    lines.push(
      "Before:",
      "",
      fence,
      example.before,
      "```",
      "",
      "After:",
      "",
      fence,
      example.after,
      "```",
      "",
    );
  }

  if (level !== "Automatic" && codemod.prompt != null) {
    const summary =
      level === "Manual"
        ? "Prompt for an AI agent (to perform this migration)"
        : "Prompt for an AI agent (to finish the cases the codemod could not migrate)";
    lines.push(
      "<details>",
      `<summary>${summary}</summary>`,
      "",
      "```text",
      codemod.prompt.trim(),
      "```",
      "",
      "</details>",
      "",
    );
  }

  return lines.join("\n");
}

/** Render an informational behavioral-change notice (no migration). */
function renderNotice(codemod: CodemodPackage): string {
  return [`### ${codemod.name}`, "", codemod.description, ""].join("\n");
}

/**
 * Render the v2 migration guide from the codemod registry. The registry is the
 * single source of truth; missing detail is added to the codemod definitions.
 * @param codemods - All registered codemods, in registration order
 * @returns The migration guide as Markdown
 */
export function renderMigrationDoc(codemods: CodemodPackage[]): string {
  // NOTE: This generator (and the registry it reads) is shaped around the v1->v2
  // migration: the title, the `v2.md` output path, and the `v2/*` rule ids /
  // `until: "2.0.0"` ranges are all hardcoded. Before this lands on `main`,
  // either clean up the v2-specific scaffolding or generalize it to be
  // version-agnostic (parameterize the target version, output path, and rule
  // namespace) so it can serve future major migrations too.
  const header = [
    "# Migrating to v2",
    "",
    "<!-- Generated from the sdk-codemod registry. Run `pnpm codemod:docs:update` and edit `packages/sdk-codemod/src/registry.ts` instead of this file. -->",
    "",
    "Run the codemods, then finish anything reported as not migrated automatically:",
    "",
    "```sh",
    "npx @tailor-platform/sdk-codemod --from <current-version> --to <target-version>",
    "```",
    "",
  ].join("\n");

  const migrations = codemods.filter((c) => !c.notice);
  const notices = codemods.filter((c) => c.notice);

  const sections = [header, migrations.map(renderEntry).join("\n")];
  if (notices.length > 0) {
    sections.push(
      [
        "## Behavioral changes (no migration required)",
        "",
        "These v2 changes alter runtime or CLI behavior; no source change is needed.",
        "",
        notices.map(renderNotice).join("\n"),
      ].join("\n"),
    );
  }

  return `${sections.join("\n")}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
