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
  const lines: string[] = [
    `## ${codemod.name}`,
    "",
    `**Migration:** ${automationLevel(codemod)}`,
    "",
  ];
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

  if (automationLevel(codemod) !== "Automatic" && codemod.prompt != null) {
    lines.push(
      "<details>",
      "<summary>Prompt for an AI agent (to finish the cases the codemod cannot migrate on its own)</summary>",
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
