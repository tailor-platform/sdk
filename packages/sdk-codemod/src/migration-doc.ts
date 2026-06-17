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
  // A Manual entry that ships no examples and no prompt is an informational
  // notice (a runtime/behavioral change with nothing in user source to edit),
  // not a hand-migration.
  const isNotice =
    level === "Manual" && (codemod.examples?.length ?? 0) === 0 && codemod.prompt == null;
  const header = isNotice
    ? "**Type:** Behavioral change (no code change required)"
    : `**Migration:** ${level}`;
  const lines: string[] = [`## ${codemod.name}`, "", header, ""];
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

/**
 * Render the v2 migration guide from the codemod registry. The registry is the
 * single source of truth; missing detail is added to the codemod definitions.
 * @param codemods - All registered codemods, in registration order
 * @returns The migration guide as Markdown
 */
export function renderMigrationDoc(codemods: CodemodPackage[]): string {
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

  const body = codemods.map(renderEntry).join("\n");
  return `${header}\n${body}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
