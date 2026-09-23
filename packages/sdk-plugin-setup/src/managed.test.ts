import { describe, expect, test } from "vitest";
import { parseDocument } from "yaml";
import {
  ManagedMergeError,
  computeManagedHash,
  isManagedHash,
  mergeUserContent,
  type Layout,
} from "./managed";
import {
  renderActionWorkflow,
  renderBranchWorkflow,
  renderCoordinateWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  type RenderBranchParams,
  type RenderResult,
} from "./templates";

const branchBase: RenderBranchParams = {
  workspaceName: "my-app",
  branch: "main",
  environment: "my-app",
  packageManager: "pnpm",
  erdPreview: null,
};

const variants: Array<[string, Layout, RenderResult]> = [
  ["branch", "workflow", renderBranchWorkflow(branchBase)],
  [
    "branch with every option",
    "workflow",
    renderBranchWorkflow({
      ...branchBase,
      workingDirectory: "apps/api",
      seedValidate: true,
      migrationDriftCheck: true,
      erdPreview: { namespaces: ["main", "audit"] },
      restrictDispatch: true,
    }),
  ],
  [
    "tag without guard",
    "workflow",
    renderTagWorkflow({
      workspaceName: "my-app",
      tagPattern: "v*",
      environment: "my-app",
      packageManager: "npm",
    }),
  ],
  [
    "tag with guard",
    "workflow",
    renderTagWorkflow({
      workspaceName: "my-app",
      tagPattern: "v*",
      branch: "main",
      environment: "my-app",
      packageManager: "npm",
      seedValidate: true,
      migrationDriftCheck: true,
      restrictDispatch: true,
    }),
  ],
  [
    "preview",
    "workflow",
    renderPreviewWorkflow({
      workspaceName: "my-app",
      branch: "main",
      environment: "my-app",
      packageManager: "pnpm",
      region: "us-west",
      requirePreviewLabel: true,
    }),
  ],
  ["action", "action", renderActionWorkflow({ workspaceName: "my-app" })],
  [
    "action with build-site slot",
    "action",
    renderActionWorkflow({ workspaceName: "my-app", hasStaticWebsites: true }),
  ],
  [
    "coordinate branch",
    "workflow",
    renderCoordinateWorkflow({
      coordinatorName: "main",
      kind: "branch",
      branch: "main",
      environment: "main",
      packageManager: "pnpm",
      restrictDispatch: true,
      actionGroups: [
        { id: "api", apps: [{ name: "api", dir: "apps/api" }] },
        {
          id: "web-admin",
          apps: [
            { name: "web", dir: "apps/web", hasStaticWebsites: true },
            { name: "admin", dir: "apps/admin" },
          ],
        },
      ],
    }),
  ],
  [
    "coordinate tag",
    "workflow",
    renderCoordinateWorkflow({
      coordinatorName: "main",
      kind: "tag",
      branch: "main",
      tagPattern: "v*",
      environment: "main",
      packageManager: "pnpm",
      restrictDispatch: true,
      actionGroups: [{ id: "api", apps: [{ name: "api", dir: "apps/api" }] }],
    }),
  ],
];

function idsIn(content: string, layout: Layout): string[] {
  const doc = parseDocument(content).toJS() as Record<string, unknown>;
  const stepIds = (steps: unknown, prefix: string): string[] =>
    (steps as Array<{ id?: string }>).map((s) => `${prefix}${String(s.id)}`);
  if (layout === "action") {
    return stepIds((doc["runs"] as { steps: unknown }).steps, "");
  }
  return Object.entries(doc["jobs"] as Record<string, { steps: unknown }>).flatMap(
    ([jobId, job]) => [jobId, ...stepIds(job.steps, `${jobId}/`)],
  );
}

const SLOTS = new Set(["build-site"]);

describe.each(variants)("%s template", (_name, layout, render) => {
  test("round-trips through the merge unchanged when there is nothing to keep", () => {
    const result = mergeUserContent({
      current: render.content,
      rendered: render.content,
      layout,
      previousIds: render.generatedIds,
      renderedIds: render.generatedIds,
      force: false,
    });
    expect(result).toEqual({ content: render.content, dropped: [] });
  });

  test("declares exactly the job and step ids it emits", () => {
    const emitted = idsIn(render.content, layout);
    expect(new Set(emitted).size).toBe(emitted.length);
    expect(new Set(render.generatedIds).size).toBe(render.generatedIds.length);
    expect(emitted.filter((id) => !SLOTS.has(id)).toSorted()).toEqual(
      render.generatedIds.toSorted(),
    );
  });
});

const render = renderBranchWorkflow(branchBase);
const lockHash = computeManagedHash(render.content, "workflow", render.generatedIds);
const hashOf = (content: string): string =>
  computeManagedHash(content, "workflow", render.generatedIds);

const addStepAfterInstall = (content: string, job: string, step: string): string =>
  content.replace(
    new RegExp(`(  ${job}:[\\s\\S]*?      - id: tailor-install\\n(?:        .*\\n)+)`),
    `$1${step}`,
  );

const USER_STEP =
  "      # Authenticate the private registry.\n      - name: Registry auth\n        run: echo auth\n";

describe("computeManagedHash", () => {
  test("is versioned so an older plugin never matches it", () => {
    expect(isManagedHash(lockHash)).toBe(true);
    expect(isManagedHash("sha256:abc")).toBe(false);
  });

  test.each([
    ["a comment", (c: string) => `${c}# note\n`],
    [
      "a user step inside a managed job",
      (c: string) => addStepAfterInstall(c, "tailor-deploy", USER_STEP),
    ],
    [
      "a user job",
      (c: string) =>
        `${c}  frontend:\n    needs: tailor-deploy\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
    ],
    [
      "a top-level env",
      (c: string) => c.replace("permissions:", "env:\n  FOO: bar\n\npermissions:"),
    ],
    [
      "an editable job field",
      (c: string) =>
        c.replace(/( {2}tailor-deploy:[\s\S]*?)runs-on: ubuntu-latest/, "$1runs-on: self-hosted"),
    ],
    [
      "a job-level env on a managed job",
      (c: string) =>
        c.replace(
          /( {2}tailor-deploy:\n(?:    .*\n)*?)( {4}steps:)/,
          "$1    env:\n      FOO: bar\n$2",
        ),
    ],
    [
      "an editable with key",
      (c: string) =>
        c.replace(
          "# editable: user-mapping: ${{ vars.TAILOR_SLACK_USER_MAPPING }}",
          "user-mapping: ${{ vars.TAILOR_SLACK_USER_MAPPING }}",
        ),
    ],
  ])("ignores %s", (_name, edit) => {
    const edited = edit(render.content);
    expect(edited).not.toBe(render.content);
    expect(hashOf(edited)).toBe(lockHash);
  });

  test.each([
    [
      "a managed if condition",
      (c: string) =>
        c.replace("github.event_name == 'push' ||", "github.event_name == 'push' || true ||"),
    ],
    ["the trigger", (c: string) => c.replace('branches: ["main"]', 'branches: ["develop"]')],
    [
      "a managed step's env",
      (c: string) =>
        c.replace(/( {6}- id: tailor-apply\n)/, "$1        env:\n          FOO: bar\n"),
    ],
    [
      "a removed managed step",
      (c: string) => c.replace(/ {6}- id: tailor-drift-check\n(?:        .*\n)+/, ""),
    ],
    ["a renamed managed job", (c: string) => c.replace("  tailor-deploy:", "  my-deploy:")],
  ])("changes on %s", (_name, edit) => {
    const edited = edit(render.content);
    expect(edited).not.toBe(render.content);
    expect(hashOf(edited)).not.toBe(lockHash);
  });

  test("throws on invalid YAML", () => {
    expect(() => hashOf("jobs: [")).toThrow(ManagedMergeError);
  });

  test("ignores the build-site slot body but not its removal", () => {
    const action = renderActionWorkflow({ workspaceName: "my-app", hasStaticWebsites: true });
    const hash = (c: string) => computeManagedHash(c, "action", action.generatedIds);
    const edited = action.content.replace(
      /(run: \|\n)(?:        #.*\n)+ {8}true\n/,
      "$1        pnpm build\n",
    );
    expect(edited).not.toBe(action.content);
    expect(hash(edited)).toBe(hash(action.content));
    const removed = action.content.replace(/ {4}- id: build-site\n(?:      .*\n)+/, "");
    expect(hash(removed)).not.toBe(hash(action.content));
  });
});

describe("mergeUserContent", () => {
  const merge = (current: string, next: RenderResult, force = false) =>
    mergeUserContent({
      current,
      rendered: next.content,
      layout: "workflow",
      previousIds: render.generatedIds,
      renderedIds: next.generatedIds,
      force,
    });

  test("keeps user steps, jobs, top-level keys, and editable fields across a template change", () => {
    const edited = [
      (c: string) => addStepAfterInstall(c, "tailor-deploy", USER_STEP),
      (c: string) =>
        `${c}  frontend:\n    needs: tailor-deploy\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
      (c: string) => c.replace("permissions:", "env:\n  FOO: bar\n\npermissions:"),
      (c: string) =>
        c.replace(/( {2}tailor-deploy:[\s\S]*?)timeout-minutes: 30/, "$1timeout-minutes: 90"),
      (c: string) =>
        c.replace(
          "# editable: user-mapping: ${{ vars.TAILOR_SLACK_USER_MAPPING }}",
          "user-mapping: ${{ vars.TAILOR_SLACK_USER_MAPPING }}",
        ),
    ].reduce((c, edit) => edit(c), render.content);
    const next = renderBranchWorkflow({ ...branchBase, seedValidate: true });

    const { content, dropped } = merge(edited, next);

    expect(dropped).toEqual([]);
    expect(computeManagedHash(content, "workflow", next.generatedIds)).toBe(
      computeManagedHash(next.content, "workflow", next.generatedIds),
    );
    const doc = parseDocument(content).toJS() as {
      env: unknown;
      jobs: Record<string, { "timeout-minutes": number; steps: Array<Record<string, unknown>> }>;
    };
    expect(doc.env).toEqual({ FOO: "bar" });
    expect(doc.jobs["frontend"]).toMatchObject({ needs: "tailor-deploy" });
    expect(doc.jobs["tailor-deploy"]?.["timeout-minutes"]).toBe(90);
    const deploySteps = doc.jobs["tailor-deploy"]?.steps ?? [];
    expect(deploySteps.map((s) => s["id"] ?? s["name"])).toEqual([
      "tailor-checkout",
      "tailor-setup",
      "tailor-install",
      "Registry auth",
      "tailor-apply",
      "tailor-slack-prereq",
      "tailor-notify",
    ]);
    expect(deploySteps.at(-1)?.["with"]).toMatchObject({
      "user-mapping": "${{ vars.TAILOR_SLACK_USER_MAPPING }}",
    });
    expect(doc.jobs["tailor-plan"]?.steps.map((s) => s["id"])).toContain("tailor-seed-validate");
    expect(content).toContain("# Authenticate the private registry.\n      - name: Registry auth");
  });

  test("puts a user step before every managed step at the start of the job", () => {
    const edited = render.content.replace(
      /( {2}tailor-deploy:[\s\S]*? {4}steps:\n)/,
      "$1      - name: First\n        run: echo first\n",
    );
    const { content } = merge(edited, render);
    const doc = parseDocument(content).toJS() as {
      jobs: Record<string, { steps: Array<Record<string, unknown>> }>;
    };
    expect(doc.jobs["tailor-deploy"]?.steps[0]).toEqual({ name: "First", run: "echo first" });
  });

  test("drops a step the SDK wrote under a retired id", () => {
    const legacy = render.content.replaceAll("tailor-slack-prereq", "slack-prereq");
    const { content } = merge(legacy, render);
    expect(content).toBe(render.content);
  });

  test("rejects a user node whose id the new template now manages unless forced", () => {
    const edited = render.content.replace(
      /( {2}tailor-plan:[\s\S]*? {6}- id: tailor-install\n(?:        .*\n)+)/,
      "$1      - id: tailor-seed-validate\n        run: echo mine\n",
    );
    const next = renderBranchWorkflow({ ...branchBase, seedValidate: true });
    const args = {
      current: edited,
      rendered: next.content,
      layout: "workflow" as const,
      previousIds: render.generatedIds,
      renderedIds: next.generatedIds,
    };
    expect(() => mergeUserContent({ ...args, force: false })).toThrow(
      /tailor-plan\/tailor-seed-validate/,
    );
    expect(mergeUserContent({ ...args, force: true }).content).toBe(next.content);
  });

  test("rejects, or with force drops, user steps whose managed job was removed", () => {
    const erd = renderBranchWorkflow({ ...branchBase, erdPreview: { namespaces: ["main"] } });
    const edited = erd.content.replace(
      /( {2}tailor-erd-preview-comment:[\s\S]*? {4}steps:\n)/,
      "$1      - name: Mine\n        run: echo mine\n",
    );
    const args = {
      current: edited,
      rendered: render.content,
      layout: "workflow" as const,
      previousIds: erd.generatedIds,
      renderedIds: render.generatedIds,
    };
    expect(() => mergeUserContent({ ...args, force: false })).toThrow(/tailor-erd-preview-comment/);
    expect(mergeUserContent({ ...args, force: true })).toEqual({
      content: render.content,
      dropped: ["tailor-erd-preview-comment/Mine"],
    });
  });

  test("rejects a user job that needs a job the new template removed", () => {
    const erd = renderBranchWorkflow({ ...branchBase, erdPreview: { namespaces: ["main"] } });
    const edited = `${erd.content}  after-erd:\n    needs: [tailor-erd-preview]\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
    expect(() =>
      mergeUserContent({
        current: edited,
        rendered: render.content,
        layout: "workflow",
        previousIds: erd.generatedIds,
        renderedIds: render.generatedIds,
        force: true,
      }),
    ).toThrow(/after-erd.*tailor-erd-preview/);
  });

  test("keeps a user-edited build-site slot body and user steps in a composite action", () => {
    const action = renderActionWorkflow({ workspaceName: "my-app", hasStaticWebsites: true });
    const edited = action.content
      .replace(/(run: \|\n)(?:        #.*\n)+ {8}true\n/, "$1        pnpm build\n")
      .replace(
        /( {4}- id: tailor-apply\n)/,
        "    - name: Upload\n      shell: bash\n      run: echo up\n$1",
      );
    const { content } = mergeUserContent({
      current: edited,
      rendered: action.content,
      layout: "action",
      previousIds: action.generatedIds,
      renderedIds: action.generatedIds,
      force: false,
    });
    const doc = parseDocument(content).toJS() as {
      runs: { steps: Array<Record<string, unknown>> };
    };
    expect(doc.runs.steps.map((s) => s["id"] ?? s["name"])).toEqual([
      "build-site",
      "Upload",
      "tailor-apply",
      "tailor-notify",
    ]);
    expect(doc.runs.steps[0]?.["run"]).toBe("pnpm build\n");
  });

  test("keeps user nodes whose ids are Object.prototype keys", () => {
    const edited = `${render.content}  constructor:\n    runs-on: ubuntu-latest\n    steps:\n      - id: toString\n        run: echo hi\n`;
    expect(merge(edited, render).content).toBe(edited);

    const action = renderActionWorkflow({ workspaceName: "my-app" });
    const editedAction = action.content.replace(
      /( {4}- id: tailor-apply\n)/,
      "    - id: constructor\n      shell: bash\n      run: echo hi\n$1",
    );
    expect(computeManagedHash(editedAction, "action", action.generatedIds)).toBe(
      computeManagedHash(action.content, "action", action.generatedIds),
    );
  });

  test("throws on invalid YAML", () => {
    expect(() => merge("jobs: [", render)).toThrow(ManagedMergeError);
  });
});
