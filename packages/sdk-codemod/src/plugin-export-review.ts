import { parse, Lang } from "@ast-grep/napi";
import type { LlmReviewFinding } from "./types";
import type { SgNode } from "@ast-grep/napi";

/**
 * Report plugin exports and imports that still need manual migration.
 * @param source - Source after the current transform
 * @param filePath - Absolute source path
 * @param relativePath - Source path relative to the project
 * @returns Locations requiring manual migration
 */
export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  const root = parse(filePath.endsWith(".tsx") ? Lang.Tsx : Lang.TypeScript, source).root();
  const findings: LlmReviewFinding[] = [];
  const report = (node: SgNode, message: string): void => {
    findings.push({
      file: relativePath,
      line: node.range().start.line + 1,
      message,
      excerpt: node.text().split("\n", 1)[0]!.trim(),
    });
  };
  const exports = root.children().filter((stmt) => stmt.kind() === "export_statement");
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const name = decl.field("name");
    let value = decl.field("value");
    while (
      value &&
      [
        "as_expression",
        "satisfies_expression",
        "parenthesized_expression",
        "type_assertion",
        "non_null_expression",
      ].some((kind) => kind === value?.kind())
    ) {
      value =
        value.children().find((child) => child.isNamed() && child.kind() !== "type_arguments") ??
        null;
    }
    if (name?.kind() !== "identifier" || !value) continue;
    const isPluginCall =
      value.kind() === "call_expression" &&
      ["definePlugins", "defineGenerators"].includes(value.field("function")?.text() ?? "");
    const isConfigArray =
      /(?:^|[/\\])tailor\.config\.[cm]?[jt]sx?$/.test(filePath) && value.kind() === "array";
    if (!isPluginCall && !isConfigArray) continue;
    const owner = decl.parent()?.parent();
    const names: string[] = [];
    if (owner?.kind() === "export_statement" && owner.parent()?.kind() === "program") {
      names.push(name.text());
    }
    if (owner?.kind() === "program" || owner?.parent()?.kind() === "program") {
      for (const stmt of exports) {
        if (stmt.field("source")) continue;
        for (const spec of stmt.findAll({ rule: { kind: "export_specifier" } })) {
          if (spec.field("name")?.text() === name.text()) {
            names.push((spec.field("alias") ?? spec.field("name"))!.text());
          }
        }
      }
    }
    if (names.length > 0 && !names.includes("plugins")) {
      report(
        decl,
        isPluginCall
          ? "Merge plugin definitions into export const plugins = definePlugins(...)."
          : "Review this exported array for plugin definitions and merge any plugins into the plugins export.",
      );
    }
  }
  for (const stmt of root
    .children()
    .filter((node) => node.kind() === "import_statement" || node.kind() === "export_statement")) {
    const modulePath = stmt.field("source")?.text().slice(1, -1);
    if (
      !modulePath ||
      !/(^|\/)tailor\.config(?:\.(?:ts|tsx|mts|cts|js|mjs|cjs))?$/.test(modulePath)
    )
      continue;
    for (const spec of stmt.findAll({
      rule: { any: [{ kind: "import_specifier" }, { kind: "export_specifier" }] },
    })) {
      if (["generator", "generators"].includes(spec.field("name")?.text() ?? "")) {
        report(spec, "Review this legacy plugin reference together with its tailor.config export.");
      }
    }
  }
  return findings;
}
