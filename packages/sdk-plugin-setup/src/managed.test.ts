import { describe, expect, test } from "vitest";
import { parseDocument } from "yaml";
import {
  ManagedMergeError,
  computeManagedHash,
  computeManagedParts,
  findEditedParts,
  findReservedIds,
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
import type { LockInputs } from "./lock";

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
    expect(emitted.toSorted()).toEqual(render.generatedIds.toSorted());
  });
});

const render = renderBranchWorkflow(branchBase);
const lockHash = computeManagedHash(render.content, "workflow", render.generatedIds);
const hashOf = (content: string): string =>
  computeManagedHash(content, "workflow", render.generatedIds);

const legacyBuildSiteAction = (): { content: string; ids: string[]; inputs: LockInputs } => {
  const action = renderActionWorkflow({ workspaceName: "my-app", hasStaticWebsites: true });
  return {
    content: action.content.replace("- id: tailor-build-site\n", "- id: build-site\n"),
    ids: action.generatedIds.filter((id) => id !== "tailor-build-site"),
    inputs: {
      branch: null,
      tagPattern: null,
      environment: "my-app",
      dir: ".",
      packageManager: "pnpm",
      hasStaticWebsites: true,
    },
  };
};

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

  test.each([
    ["invalid YAML", "jobs: ["],
    ["a sequence root", "[]\n"],
    ["an empty file", ""],
  ])("throws on %s", (_name, content) => {
    expect(() => hashOf(content)).toThrow(ManagedMergeError);
  });

  test("rejects an alias bomb instead of expanding it", () => {
    const refs = (name: string, prev: string) =>
      `${name}: &${name} [${Array(10).fill(`*${prev}`).join(", ")}]`;
    const bomb = [
      `${render.content}x0: &x0 [a]`,
      refs("x1", "x0"),
      refs("x2", "x1"),
      refs("x3", "x2"),
      refs("x4", "x3"),
      refs("x5", "x4"),
      "",
    ].join("\n");
    expect(() => hashOf(bomb)).toThrow(ManagedMergeError);
  });

  test("rejects a recursive alias instead of recursing forever", () => {
    const recursive = render.content.replace(
      "permissions:\n  contents: read\n",
      "permissions: &p {contents: read, self: *p}\n",
    );
    expect(recursive).not.toBe(render.content);
    expect(() => hashOf(recursive)).toThrow(ManagedMergeError);
  });

  test("ignores user-mapping on a coordinator step that calls an app action", () => {
    const coordinate = variants.find(([name]) => name === "coordinate branch")?.[2];
    if (!coordinate) throw new Error("missing coordinate variant");
    const hash = (c: string) => computeManagedHash(c, "workflow", coordinate.generatedIds);
    const edited = coordinate.content.replace(
      /( {6}- id: tailor-deploy-api\n(?:        .*\n)*? {8}with:\n)/,
      "$1          user-mapping: ${{ vars.TAILOR_SLACK_USER_MAPPING }}\n",
    );
    expect(edited).not.toBe(coordinate.content);
    expect(hash(edited)).toBe(hash(coordinate.content));

    const { content } = mergeUserContent({
      current: edited,
      rendered: coordinate.content,
      layout: "workflow",
      previousIds: coordinate.generatedIds,
      renderedIds: coordinate.generatedIds,
      force: true,
    });
    expect(content).toBe(edited);
  });

  test("ignores the tailor-build-site run command but not its removal", () => {
    const action = renderActionWorkflow({ workspaceName: "my-app", hasStaticWebsites: true });
    const hash = (c: string) => computeManagedHash(c, "action", action.generatedIds);
    const edited = action.content.replace(
      /(run: \|\n)(?:        #.*\n)+ {8}true\n/,
      "$1        pnpm build\n",
    );
    expect(edited).not.toBe(action.content);
    expect(hash(edited)).toBe(hash(action.content));
    const removed = action.content.replace(/ {4}- id: tailor-build-site\n(?:      .*\n)+/, "");
    expect(hash(removed)).not.toBe(hash(action.content));
  });

  test("hashes a build-site step an older template wrote like the slot it became", () => {
    const { content, ids, inputs } = legacyBuildSiteAction();
    const hash = (c: string) => computeManagedHash(c, "action", ids, inputs);
    const editedRun = content.replace(
      /(run: \|\n)(?:        #.*\n)+ {8}true\n/,
      "$1        pnpm build\n",
    );
    expect(editedRun).not.toBe(content);
    expect(hash(editedRun)).toBe(hash(content));
    const editedIf = content.replace("if: inputs.build-site == 'true'", "if: always()");
    expect(editedIf).not.toBe(content);
    expect(hash(editedIf)).not.toBe(hash(content));
  });
});

describe("computeManagedHash for a non-prefixed id the lock records", () => {
  test("ignores edits to that step, since only tailor- ids are the SDK's", () => {
    const withStep = (run: string) =>
      addStepAfterInstall(
        render.content,
        "tailor-deploy",
        `      - id: registry-auth\n        run: ${run}\n`,
      );
    const ids = [...render.generatedIds, "tailor-deploy/registry-auth"];
    expect(computeManagedHash(withStep("echo edited"), "workflow", ids)).toBe(
      computeManagedHash(withStep("echo auth"), "workflow", ids),
    );
  });
});

describe("computeManagedHash for a tailor-build-site step the lock does not record", () => {
  test("ignores the step, so only the reserved prefix reports it", () => {
    const action = renderActionWorkflow({ workspaceName: "my-app" });
    const edited = action.content.replace(
      /( {4}- id: tailor-apply\n)/,
      "    - id: tailor-build-site\n      shell: bash\n      run: pnpm run build:docs\n$1",
    );
    expect(edited).not.toBe(action.content);
    expect(computeManagedHash(edited, "action", action.generatedIds)).toBe(
      computeManagedHash(action.content, "action", action.generatedIds),
    );
    expect(findReservedIds(edited, "action", action.generatedIds)).toEqual(["tailor-build-site"]);
  });
});

describe("findEditedParts", () => {
  const recorded = computeManagedParts(render.content, "workflow", render.generatedIds);
  const edited = (content: string) =>
    findEditedParts(recorded, computeManagedParts(content, "workflow", render.generatedIds));

  test.each([
    ["nothing for an untouched file", (c: string) => c, []],
    [
      "nothing for the user's own steps and editable fields",
      (c: string) =>
        addStepAfterInstall(c, "tailor-deploy", USER_STEP).replace(
          /( {2}tailor-deploy:[\s\S]*?)timeout-minutes: 30/,
          "$1timeout-minutes: 90",
        ),
      [],
    ],
    [
      "a managed step whose content changed",
      (c: string) =>
        c.replace(/( {6}- id: tailor-apply\n)/, "$1        env:\n          FOO: bar\n"),
      ["tailor-deploy/tailor-apply"],
    ],
    [
      "a managed top-level key",
      (c: string) => c.replace('branches: ["main"]', 'branches: ["develop"]'),
      ["on"],
    ],
    [
      "a removed managed step",
      (c: string) => c.replace(/ {6}- id: tailor-drift-check\n(?:        .*\n)+/, ""),
      ["tailor-plan", "tailor-plan/tailor-drift-check"],
    ],
    [
      "a renamed managed job once, without its steps",
      (c: string) => c.replace("  tailor-deploy:", "  my-deploy:"),
      ["tailor-deploy"],
    ],
  ])("names %s", (_name, edit, expected) => {
    expect(edited(edit(render.content))).toEqual(expected);
  });

  test("names the job whose managed steps were reordered", () => {
    const reordered = render.content.replace(
      /( {6}- id: tailor-setup\n(?:        .*\n)+)( {6}- id: tailor-install\n(?:        .*\n)+)/,
      "$2$1",
    );
    expect(reordered).not.toBe(render.content);
    expect(edited(reordered)).toEqual(["tailor-plan"]);
  });

  test("names a changed condition on the composite action's tailor-build-site step", () => {
    const action = renderActionWorkflow({ workspaceName: "my-app", hasStaticWebsites: true });
    const parts = (c: string) => computeManagedParts(c, "action", action.generatedIds);
    const changed = action.content.replace("if: inputs.build-site == 'true'", "if: always()");
    expect(findEditedParts(parts(action.content), parts(changed))).toEqual(["tailor-build-site"]);
  });
});

describe("findReservedIds", () => {
  test("lists the user's jobs and steps whose ids use the tailor- prefix", () => {
    const edited = `${addStepAfterInstall(
      render.content,
      "tailor-deploy",
      "      - id: tailor-build-frontend\n        run: echo build\n",
    )}  tailor-lint:\n    runs-on: ubuntu-latest\n    steps:\n      - id: tailor-checkout\n        run: echo lint\n`;
    expect(findReservedIds(edited, "workflow", render.generatedIds)).toEqual([
      "tailor-deploy/tailor-build-frontend",
      "tailor-lint",
      "tailor-lint/tailor-checkout",
    ]);
  });

  test("lists a composite action step whose id uses the tailor- prefix", () => {
    const action = renderActionWorkflow({ workspaceName: "my-app" });
    const edited = action.content.replace(
      /( {4}- id: tailor-apply\n)/,
      "    - id: tailor-upload\n      shell: bash\n      run: echo up\n$1",
    );
    expect(findReservedIds(edited, "action", action.generatedIds)).toEqual(["tailor-upload"]);
  });

  test("lists nothing for a freshly generated file", () => {
    expect(findReservedIds(render.content, "workflow", render.generatedIds)).toEqual([]);
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
    const { content } = mergeUserContent({
      current: legacy,
      rendered: render.content,
      layout: "workflow",
      previousIds: render.generatedIds.filter((id) => id !== "tailor-deploy/tailor-slack-prereq"),
      renderedIds: render.generatedIds,
      force: false,
    });
    expect(content).toBe(render.content);
  });

  test("rejects a user node whose id the new template now manages, even when forced", () => {
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
      /"tailor-plan\/tailor-seed-validate" uses the tailor- prefix/,
    );
    expect(() => mergeUserContent({ ...args, force: true })).toThrow(
      /"tailor-plan\/tailor-seed-validate" uses the tailor- prefix/,
    );
  });

  test.each([
    [
      "a user step in a managed job",
      (c: string) =>
        addStepAfterInstall(
          c,
          "tailor-deploy",
          "      - id: tailor-build-frontend\n        run: echo build\n",
        ),
      "tailor-deploy/tailor-build-frontend",
    ],
    [
      "a user job",
      (c: string) =>
        `${c}  tailor-lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo lint\n`,
      "tailor-lint",
    ],
    [
      "a step in a user job",
      (c: string) =>
        `${c}  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - id: tailor-checkout\n        run: echo lint\n`,
      "lint/tailor-checkout",
    ],
  ])("rejects %s with a tailor- id, even when forced", (_name, edit, id) => {
    const edited = edit(render.content);
    expect(edited).not.toBe(render.content);
    const message = `"${id}" uses the tailor- prefix reserved for SDK-managed jobs and steps`;
    expect(() => merge(edited, render)).toThrow(message);
    expect(() => merge(edited, render, true)).toThrow(message);
  });

  test("keeps a user step whose id the lock wrongly records as managed", () => {
    const edited = addStepAfterInstall(
      render.content,
      "tailor-deploy",
      "      - id: build-frontend\n        run: echo build\n",
    );
    const { content } = mergeUserContent({
      current: edited,
      rendered: render.content,
      layout: "workflow",
      previousIds: [...render.generatedIds, "tailor-deploy/build-frontend"],
      renderedIds: render.generatedIds,
      force: true,
    });
    expect(content).toBe(edited);
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

  test("keeps a user-edited tailor-build-site run command and user steps in a composite action", () => {
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
      "tailor-build-site",
      "Upload",
      "tailor-apply",
      "tailor-notify",
    ]);
    expect(doc.runs.steps[0]?.["run"]).toBe("pnpm build\n");
  });

  test("moves the run command of a build-site step an older template wrote into tailor-build-site", () => {
    const action = renderActionWorkflow({ workspaceName: "my-app", hasStaticWebsites: true });
    const legacy = legacyBuildSiteAction();
    const edited = legacy.content.replace(
      /(run: \|\n)(?:        #.*\n)+ {8}true\n/,
      "$1        pnpm build\n",
    );
    const { content } = mergeUserContent({
      current: edited,
      rendered: action.content,
      layout: "action",
      previousIds: legacy.ids,
      previousInputs: legacy.inputs,
      renderedIds: action.generatedIds,
      force: false,
    });
    const doc = parseDocument(content).toJS() as {
      runs: { steps: Array<Record<string, unknown>> };
    };
    expect(doc.runs.steps.map((s) => s["id"])).toEqual([
      "tailor-build-site",
      "tailor-apply",
      "tailor-notify",
    ]);
    expect(doc.runs.steps[0]?.["run"]).toBe("pnpm build\n");
  });

  test("keeps a user step right after the build-site step an older template wrote", () => {
    const action = renderActionWorkflow({ workspaceName: "my-app", hasStaticWebsites: true });
    const legacy = legacyBuildSiteAction();
    const edited = legacy.content.replace(
      /( {4}- id: tailor-apply\n)/,
      "    - name: Upload\n      shell: bash\n      run: echo up\n$1",
    );
    const { content } = mergeUserContent({
      current: edited,
      rendered: action.content,
      layout: "action",
      previousIds: legacy.ids,
      previousInputs: legacy.inputs,
      renderedIds: action.generatedIds,
      force: false,
    });
    const doc = parseDocument(content).toJS() as {
      runs: { steps: Array<Record<string, unknown>> };
    };
    expect(doc.runs.steps.map((s) => s["id"] ?? s["name"])).toEqual([
      "tailor-build-site",
      "Upload",
      "tailor-apply",
      "tailor-notify",
    ]);
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

  test("keeps a user step with a retired id once the lock records its replacement", () => {
    const edited = render.content.replace(
      /( {6}- id: tailor-slack-prereq\n)/,
      "      - id: slack-prereq\n        run: echo mine\n$1",
    );
    expect(merge(edited, render).content).toBe(edited);
  });

  test.each([
    [
      "at the end of the file",
      (c: string) =>
        `${c}  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo lint\n#  e2e:\n#    runs-on: ubuntu-latest\n`,
      "#  e2e:",
    ],
    [
      "above a user job placed first",
      (c: string) =>
        c.replace(
          "jobs:\n",
          "jobs:\n  # Runs on every push.\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo lint\n",
        ),
      "# Runs on every push.",
    ],
    [
      "above a user step placed first in a managed job",
      (c: string) =>
        c.replace(
          /( {2}tailor-deploy:[\s\S]*? {4}steps:\n)/,
          "$1      # Free disk space first.\n      - name: Free disk\n        run: echo free\n",
        ),
      "# Free disk space first.",
    ],
  ])("keeps a comment %s", (_name, edit, comment) => {
    expect(merge(edit(render.content), render).content).toContain(comment);
  });

  test("wraps an alias to an anchor on a managed node in a merge error", () => {
    const edited = `${render.content.replace("permissions:", "permissions: &perms")}  mine:\n    runs-on: ubuntu-latest\n    permissions: *perms\n    steps:\n      - run: echo hi\n`;
    expect(hashOf(edited)).toBe(lockHash);
    expect(() => merge(edited, render)).toThrow(ManagedMergeError);
  });

  test("keeps a user step that reuses a retired id outside its original job", () => {
    const edited = render.content.replace(
      /( {6}- id: tailor-plan\n)/,
      "      - id: slack-prereq\n        run: echo mine\n$1",
    );
    expect(merge(edited, render).content).toBe(edited);
  });
});
