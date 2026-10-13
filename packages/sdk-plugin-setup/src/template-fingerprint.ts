import { createHash } from "node:crypto";
import {
  PACKAGE_MANAGERS,
  renderBranchWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
} from "./templates";

type RenderedTemplate = { name: string; content: string; generatedIds: readonly string[] };

const COMMON = { workspaceName: "my-app", environment: "production" } as const;

/**
 * Fingerprint a set of rendered templates.
 * @param templates - Rendered workflows with their managed ids
 * @returns A hex SHA-256 over every template's name, content, and managed ids
 */
export function fingerprintOf(templates: readonly RenderedTemplate[]): string {
  return createHash("sha256").update(JSON.stringify(templates)).digest("hex");
}

function renderAll(): RenderedTemplate[] {
  const out: RenderedTemplate[] = [];
  const add = (name: string, rendered: { content: string; generatedIds: string[] }) =>
    out.push({ name, ...rendered });

  for (const packageManager of PACKAGE_MANAGERS) {
    const base = { ...COMMON, packageManager };
    add(
      `branch/${packageManager}`,
      renderBranchWorkflow({ ...base, branch: "main", erdPreview: null }),
    );
    add(`tag/${packageManager}`, renderTagWorkflow({ ...base, tagPattern: "v*" }));
    add(
      `preview/${packageManager}`,
      renderPreviewWorkflow({ ...base, branch: "main", region: "us-west" }),
    );
  }

  const full = { ...COMMON, packageManager: "pnpm", workingDirectory: "apps/backend" } as const;
  add(
    "branch/full",
    renderBranchWorkflow({
      ...full,
      branch: "main",
      seedValidate: true,
      migrationDriftCheck: true,
      erdPreview: { namespaces: ["main", "analytics"] },
      restrictDispatch: true,
    }),
  );
  add(
    "tag/full",
    renderTagWorkflow({
      ...full,
      tagPattern: "v*",
      branch: "main",
      seedValidate: true,
      migrationDriftCheck: true,
      restrictDispatch: true,
    }),
  );
  add(
    "tag/guarded-unrestricted",
    renderTagWorkflow({ ...COMMON, packageManager: "pnpm", tagPattern: "v*", branch: "main" }),
  );
  add(
    "tag/unguarded-restricted",
    renderTagWorkflow({
      ...COMMON,
      packageManager: "pnpm",
      tagPattern: "v*",
      restrictDispatch: true,
    }),
  );
  add(
    "preview/full",
    renderPreviewWorkflow({
      ...full,
      branch: "main",
      region: "us-west",
      requirePreviewLabel: true,
    }),
  );
  const apps = [
    { dir: "apps/erp/backend", seedValidate: true, migrationDriftCheck: true },
    { dir: "apps/users/backend" },
  ];
  const extraPaths = ["apps/*/frontend/**", "!apps/erp/backend/**/*.md"];
  add(
    "branch/paths",
    renderBranchWorkflow({ ...full, branch: "main", erdPreview: null, extraPaths }),
  );
  add(
    "branch/multi-dir",
    renderBranchWorkflow({
      ...COMMON,
      packageManager: "pnpm",
      branch: "main",
      apps,
      extraPaths,
      erdPreview: { namespaces: ["main", "analytics"] },
      restrictDispatch: true,
    }),
  );
  add(
    "tag/multi-dir",
    renderTagWorkflow({
      ...COMMON,
      packageManager: "pnpm",
      tagPattern: "v*",
      branch: "main",
      apps,
    }),
  );
  add(
    "preview/multi-dir",
    renderPreviewWorkflow({
      ...COMMON,
      packageManager: "pnpm",
      branch: "main",
      region: "us-west",
      apps,
      extraPaths,
    }),
  );
  return out;
}

/**
 * Fingerprint the templates as this build renders them across representative inputs.
 * @returns A hex SHA-256 that changes whenever any generated workflow or managed id changes
 */
export function renderedTemplatesFingerprint(): string {
  return fingerprintOf(renderAll());
}
