import { createHash } from "node:crypto";
import {
  AUTOFIX_PROVIDERS,
  PACKAGE_MANAGERS,
  renderBranchWorkflow,
  renderPreviewCleanupWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  type RenderResult,
  type WorkflowKind,
} from "./templates";
import { renderAutofixFor } from "./test-helpers/autofix";

/** A workflow template: the stem of its `<template>.workflow.yml` file. */
export type WorkflowTemplate = WorkflowKind | "autofix";

/** One representative render of a workflow template. */
export type RenderedTemplate = RenderResult & {
  /** `<template>/<variant>`, unique across the renders. */
  name: string;
  template: WorkflowTemplate;
};

/** GitHub Environment the deploy targets of {@link renderedTemplates} are rendered for. */
export const RENDERED_ENVIRONMENT = "production";

const COMMON = { workspaceName: "my-app", environment: RENDERED_ENVIRONMENT } as const;

/**
 * Fingerprint a set of rendered templates.
 * @param templates - Rendered workflows with their managed ids
 * @returns A hex SHA-256 over every template's name, content, and managed ids
 */
export function fingerprintOf(
  templates: readonly Pick<RenderedTemplate, "name" | "content" | "generatedIds">[],
): string {
  const hashed = templates.map(({ name, content, generatedIds }) => ({
    name,
    content,
    generatedIds,
  }));
  return createHash("sha256").update(JSON.stringify(hashed)).digest("hex");
}

/**
 * Render every workflow template across representative inputs: each deploy template under each
 * package manager, and each option that changes a template's jobs or steps. Tests that check every
 * template iterate these renders, and the release fingerprint hashes them.
 * @returns The renders, each named `<template>/<variant>`
 */
export function renderedTemplates(): RenderedTemplate[] {
  const out: RenderedTemplate[] = [];
  const add = (template: WorkflowTemplate, variant: string, rendered: RenderResult) =>
    out.push({ name: `${template}/${variant}`, ...rendered, template });

  for (const packageManager of PACKAGE_MANAGERS) {
    const base = { ...COMMON, packageManager };
    add(
      "branch",
      packageManager,
      renderBranchWorkflow({ ...base, branch: "main", erdPreview: null }),
    );
    add("tag", packageManager, renderTagWorkflow({ ...base, tagPattern: "v*" }));
    add(
      "preview",
      packageManager,
      renderPreviewWorkflow({ ...base, branch: "main", region: "us-west" }),
    );
    add(
      "preview-cleanup",
      packageManager,
      renderPreviewCleanupWorkflow({ ...base, branch: "main" }),
    );
  }

  const root = { ...COMMON, packageManager: "pnpm" } as const;
  const full = { ...root, workingDirectory: "apps/backend" } as const;
  add(
    "branch",
    "full",
    renderBranchWorkflow({
      ...full,
      branch: "main",
      seedValidate: true,
      migrationDriftCheck: true,
      erdPreview: { namespaces: ["main", "analytics"] },
      restrictDispatch: true,
      seed: { datasets: ["preview", "local"] },
    }),
  );
  add(
    "branch",
    "erd-preview",
    renderBranchWorkflow({ ...root, branch: "main", erdPreview: { namespaces: ["main"] } }),
  );
  add(
    "branch",
    "ghes",
    renderBranchWorkflow({
      ...full,
      branch: "main",
      erdPreview: { namespaces: ["main", "analytics"] },
      ghes: true,
    }),
  );
  add(
    "branch",
    "ghes-root",
    renderBranchWorkflow({
      ...root,
      branch: "main",
      erdPreview: { namespaces: ["main"] },
      ghes: true,
    }),
  );
  add(
    "branch",
    "seed-validate",
    renderBranchWorkflow({ ...full, branch: "main", seedValidate: true, erdPreview: null }),
  );
  add(
    "branch",
    "migration-test",
    renderBranchWorkflow({
      ...full,
      branch: "main",
      migrationDriftCheck: true,
      erdPreview: { namespaces: ["main"] },
      migrationTest: { label: "tailor:migration-test" },
    }),
  );
  add(
    "branch",
    "migration-test-root",
    renderBranchWorkflow({
      ...root,
      branch: "main",
      migrationDriftCheck: true,
      erdPreview: null,
      migrationTest: { label: "tailor:migration-test" },
    }),
  );
  add(
    "branch",
    "migration-test-dedicated",
    renderBranchWorkflow({
      ...full,
      branch: "main",
      migrationDriftCheck: true,
      erdPreview: null,
      migrationTest: { label: "tailor:migration-test", environment: "prod-source" },
    }),
  );
  add(
    "branch",
    "split-plan-environment",
    renderBranchWorkflow({
      ...full,
      branch: "main",
      seedValidate: true,
      migrationDriftCheck: true,
      erdPreview: null,
      migrationTest: { label: "tailor:migration-test" },
      seed: { datasets: [] },
      splitPlanEnvironment: true,
    }),
  );
  add(
    "tag",
    "full",
    renderTagWorkflow({
      ...full,
      tagPattern: "v*",
      branch: "main",
      seedValidate: true,
      migrationDriftCheck: true,
      seed: { datasets: [] },
      restrictDispatch: true,
    }),
  );
  add(
    "tag",
    "guarded-unrestricted",
    renderTagWorkflow({ ...root, tagPattern: "v*", branch: "main" }),
  );
  add(
    "tag",
    "unguarded-restricted",
    renderTagWorkflow({ ...root, tagPattern: "v*", restrictDispatch: true }),
  );
  add(
    "preview",
    "full",
    renderPreviewWorkflow({
      ...full,
      branch: "main",
      region: "us-west",
      require: "label",
      seed: { datasets: ["preview"] },
    }),
  );
  add(
    "preview",
    "require-ready",
    renderPreviewWorkflow({ ...full, branch: "main", region: "us-west", require: "ready" }),
  );
  for (const require of ["label", "ready"] as const) {
    add(
      "preview",
      `require-${require}-root`,
      renderPreviewWorkflow({ ...root, branch: "main", region: "us-west", require }),
    );
  }
  add("preview-cleanup", "full", renderPreviewCleanupWorkflow({ ...full, branch: "main" }));
  const apps = [
    { dir: "apps/erp/backend", seedValidate: true, migrationDriftCheck: true },
    { dir: "apps/users/backend" },
  ];
  const extraPaths = ["apps/*/frontend/**", "!apps/erp/backend/**/*.md"];
  add(
    "branch",
    "paths",
    renderBranchWorkflow({ ...full, branch: "main", erdPreview: null, extraPaths }),
  );
  add(
    "branch",
    "multi-dir",
    renderBranchWorkflow({
      ...root,
      branch: "main",
      apps,
      extraPaths,
      erdPreview: { namespaces: ["main", "analytics"] },
      restrictDispatch: true,
    }),
  );
  add("tag", "multi-dir", renderTagWorkflow({ ...root, tagPattern: "v*", branch: "main", apps }));
  add(
    "preview",
    "multi-dir",
    renderPreviewWorkflow({ ...root, branch: "main", region: "us-west", apps, extraPaths }),
  );
  add(
    "preview-cleanup",
    "multi-dir",
    renderPreviewCleanupWorkflow({ ...root, branch: "main", apps }),
  );
  for (const provider of AUTOFIX_PROVIDERS) {
    add("autofix", provider, renderAutofixFor(provider));
    add(
      "autofix",
      `${provider}-multi-dir`,
      renderAutofixFor(provider, { dirs: apps.map((app) => app.dir) }),
    );
  }
  return out;
}

/**
 * Fingerprint the templates as this build renders them across representative inputs.
 * @returns A hex SHA-256 that changes whenever any generated workflow or managed id changes
 */
export function renderedTemplatesFingerprint(): string {
  return fingerprintOf(renderedTemplates());
}
