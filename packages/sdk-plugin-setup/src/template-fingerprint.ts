import { createHash } from "node:crypto";
import {
  renderActionWorkflow,
  renderBranchWorkflow,
  renderCoordinateWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  renderTailorSetupAction,
  type PackageManager,
} from "./templates";

type RenderedTemplate = { name: string; content: string; generatedIds: readonly string[] };

const PACKAGE_MANAGERS: PackageManager[] = ["pnpm", "yarn", "npm", "bun"];
const COMMON = { workspaceName: "my-app", environment: "my-app" } as const;

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
    add(`tailor-setup/${packageManager}`, {
      content: renderTailorSetupAction({ packageManager }),
      generatedIds: [],
    });
    for (const kind of ["branch", "tag"] as const) {
      add(
        `coordinate-${kind}/${packageManager}`,
        renderCoordinateWorkflow({
          coordinatorName: "platform",
          kind,
          ...(kind === "branch" ? { branch: "main" } : { tagPattern: "v*", branch: "main" }),
          environment: "platform",
          packageManager,
          restrictDispatch: true,
          actionGroups: [
            { id: "core", apps: [{ name: "ims", dir: "apps/ims", hasStaticWebsites: true }] },
            {
              id: "apps",
              apps: [
                { name: "crm", dir: "apps/crm" },
                { name: "pos", dir: "apps/pos" },
              ],
            },
          ],
        }),
      );
    }
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
    "preview/full",
    renderPreviewWorkflow({
      ...full,
      branch: "main",
      region: "us-west",
      requirePreviewLabel: true,
    }),
  );
  add("action/minimal", renderActionWorkflow({ workspaceName: "my-app" }));
  add(
    "action/full",
    renderActionWorkflow({
      workspaceName: "my-app",
      workingDirectory: "apps/backend",
      hasStaticWebsites: true,
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
