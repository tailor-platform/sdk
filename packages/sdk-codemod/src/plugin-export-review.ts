import { parse, Lang } from "@ast-grep/napi";
import { isTailorConfigPath } from "./plugin-export-bindings";
import type { LlmReviewFinding } from "./types";
import type { SgNode } from "@ast-grep/napi";

const CONFIG_MODULE_SOURCE = /(^|\/)tailor\.config(?:\.(?:ts|tsx|mts|cts|js|mjs|cjs))?$/;

const CONFIG_FACTORIES = new Set([
  "defineConfig",
  "defineAuth",
  "defineIdp",
  "defineStaticWebSite",
  "defineAIGateway",
  "defineSecretManager",
  "defineWorkflowExecutionPolicy",
  "defineWorkflowExecutionPolicies",
]);

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
  const isConfigFile = isTailorConfigPath(filePath);
  const factories = new Set<string>();
  const configFactories = new Set<string>();
  for (const stmt of root.children().filter((node) => node.kind() === "import_statement")) {
    if (stmt.field("source")?.text().slice(1, -1) !== "@tailor-platform/sdk") continue;
    for (const spec of stmt.findAll({ rule: { kind: "import_specifier" } })) {
      if (CONFIG_FACTORIES.has(spec.field("name")?.text() ?? "")) {
        configFactories.add((spec.field("alias") ?? spec.field("name"))!.text());
      }
      if (["definePlugins", "defineGenerators"].includes(spec.field("name")?.text() ?? "")) {
        factories.add((spec.field("alias") ?? spec.field("name"))!.text());
      }
    }
    for (const spec of stmt.findAll({ rule: { kind: "namespace_import" } })) {
      const local = spec
        .children()
        .find((child) => child.kind() === "identifier")
        ?.text();
      if (local) {
        factories.add(`${local}.definePlugins`);
        factories.add(`${local}.defineGenerators`);
        for (const factory of CONFIG_FACTORIES) configFactories.add(`${local}.${factory}`);
      }
    }
  }
  const report = (node: SgNode, message: string): void => {
    findings.push({
      file: relativePath,
      line: node.range().start.line + 1,
      message,
      excerpt: node.text().split("\n", 1)[0]!.trim(),
    });
  };
  const exports = root.children().filter((stmt) => stmt.kind() === "export_statement");
  for (const decl of isConfigFile ? root.findAll({ rule: { kind: "variable_declarator" } }) : []) {
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
    const calledFactory =
      value.kind() === "call_expression" ? value.field("function")?.text() : undefined;
    if (calledFactory && configFactories.has(calledFactory)) continue;
    const isPluginCall = calledFactory !== undefined && factories.has(calledFactory);
    const isConfigArray = value.kind() === "array";
    // An indirect value can also be a plugin array; do not silently assume otherwise.
    const isUnclassifiedValue = ![
      "string",
      "number",
      "true",
      "false",
      "null",
      "object",
      "arrow_function",
      "function_expression",
      "class",
    ].some((kind) => kind === value?.kind());
    if (!isPluginCall && !isConfigArray && !isUnclassifiedValue) continue;
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
          : "Review this noncanonical config export for plugin definitions and expose any plugins as plugins.",
      );
    }
  }
  for (const stmt of root.children()) {
    const isExport = stmt.kind() === "export_statement";
    if (!isExport && stmt.kind() !== "import_statement") continue;
    const modulePath = stmt.field("source")?.text().slice(1, -1);
    const isConfigSource = modulePath !== undefined && CONFIG_MODULE_SOURCE.test(modulePath);
    if (isExport && (isConfigFile || isConfigSource)) {
      if (
        stmt.children().some((child) => child.kind() === "*" || child.kind() === "namespace_export")
      ) {
        report(
          stmt,
          "Review this indirect re-export and expose any config plugin arrays as plugins.",
        );
      }
      for (const spec of stmt.findAll({ rule: { kind: "export_specifier" } })) {
        const exportedName = (spec.field("alias") ?? spec.field("name"))?.text();
        if (
          (isConfigFile && exportedName !== "plugins" && exportedName !== "default") ||
          (isConfigSource && ["generator", "generators"].includes(spec.field("name")?.text() ?? ""))
        ) {
          report(
            spec,
            "Review this re-export for plugin definitions and expose config plugins as plugins.",
          );
        }
      }
    }
    if (!isConfigSource || isExport) continue;
    for (const namespace of stmt.findAll({ rule: { kind: "namespace_import" } })) {
      report(
        namespace,
        "Review this config namespace import and replace legacy plugin member references with plugins.",
      );
    }
    for (const spec of stmt.findAll({ rule: { kind: "import_specifier" } })) {
      if (["generator", "generators"].includes(spec.field("name")?.text() ?? "")) {
        report(spec, "Review this legacy plugin reference together with its tailor.config export.");
      }
    }
  }
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    if (call.field("function")?.text() !== "import") continue;
    const modulePath = call
      .field("arguments")
      ?.children()
      .find((child) => child.kind() === "string")
      ?.text()
      .slice(1, -1);
    if (modulePath && CONFIG_MODULE_SOURCE.test(modulePath)) {
      report(
        call,
        "Review this dynamic config import and replace legacy plugin member references with plugins.",
      );
    }
  }
  return findings;
}
