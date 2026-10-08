import { describe, expect, test } from "vitest";
import { parseDocument } from "yaml";
import {
  ENVIRONMENT_EDITABLE_JOBS,
  ManagedMergeError,
  computeManagedHash,
  computeManagedParts,
  describeReservedId,
  findEditedParts,
  findReservedIds,
  isManagedHash,
  mergeUserContent,
} from "./managed";
import {
  renderBranchWorkflow,
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

const variants: Array<[string, RenderResult]> = [
  ["branch", renderBranchWorkflow(branchBase)],
  [
    "branch with every option",
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
    renderTagWorkflow({
      workspaceName: "my-app",
      tagPattern: "v*",
      environment: "my-app",
      packageManager: "npm",
    }),
  ],
  [
    "tag with guard",
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
    renderPreviewWorkflow({
      workspaceName: "my-app",
      branch: "main",
      environment: "my-app",
      packageManager: "pnpm",
      region: "us-west",
      requirePreviewLabel: true,
    }),
  ],
];

function idsIn(content: string): string[] {
  const doc = parseDocument(content).toJS() as Record<string, unknown>;
  const stepIds = (steps: unknown, prefix: string): string[] =>
    (steps as Array<{ id?: string }>).map((s) => `${prefix}${String(s.id)}`);
  return Object.entries(doc["jobs"] as Record<string, { steps: unknown }>).flatMap(
    ([jobId, job]) => [jobId, ...stepIds(job.steps, `${jobId}/`)],
  );
}

describe.each(variants)("%s template", (_name, render) => {
  test("round-trips through the merge unchanged when there is nothing to keep", () => {
    const result = mergeUserContent({
      current: render.content,
      rendered: render.content,
      previousIds: render.generatedIds,
      renderedIds: render.generatedIds,
      force: false,
    });
    expect(result).toEqual({ content: render.content, dropped: [] });
  });

  test("gives every job and step it emits an id with the reserved tailor- prefix", () => {
    for (const id of idsIn(render.content)) {
      expect(id.slice(id.lastIndexOf("/") + 1)).toMatch(/^tailor-/);
    }
  });

  test("declares exactly the job and step ids it emits", () => {
    const emitted = idsIn(render.content);
    expect(new Set(emitted).size).toBe(emitted.length);
    expect(new Set(render.generatedIds).size).toBe(render.generatedIds.length);
    expect(emitted.toSorted()).toEqual(render.generatedIds.toSorted());
  });
});

describe("ENVIRONMENT_EDITABLE_JOBS", () => {
  const jobsOf = (environment: boolean): Set<string> =>
    new Set(
      variants
        .flatMap(([, { content }]) =>
          Object.entries(
            (parseDocument(content).toJS() as { jobs: Record<string, Record<string, unknown>> })
              .jobs,
          ),
        )
        .filter(([, job]) => Object.hasOwn(job, "environment") === environment)
        .map(([jobId]) => jobId),
    );

  test("lists every managed job some template writes without an environment", () => {
    expect(new Set(ENVIRONMENT_EDITABLE_JOBS)).toEqual(jobsOf(false));
  });

  test("lists no managed job that any template writes with an environment", () => {
    expect(ENVIRONMENT_EDITABLE_JOBS.filter((jobId) => jobsOf(true).has(jobId))).toEqual([]);
  });
});

const render = renderBranchWorkflow(branchBase);
const lockHash = computeManagedHash(render.content, render.generatedIds);
const hashOf = (content: string): string => computeManagedHash(content, render.generatedIds);

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
    expect(computeManagedHash(withStep("echo edited"), ids)).toBe(
      computeManagedHash(withStep("echo auth"), ids),
    );
  });
});

describe("findEditedParts", () => {
  const recorded = computeManagedParts(render.content, render.generatedIds);
  const edited = (content: string) =>
    findEditedParts(recorded, computeManagedParts(content, render.generatedIds));

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
});

describe("describeReservedId", () => {
  test("suggests the id without the prefix", () => {
    expect(describeReservedId("tailor-deploy/tailor-build-frontend")).toContain(
      'Rename it (e.g. "build-frontend")',
    );
  });

  test("leaves out the suggestion when nothing follows the prefix", () => {
    expect(describeReservedId("tailor-deploy/tailor-")).toBe(
      '"tailor-deploy/tailor-" uses the tailor- prefix reserved for SDK-managed jobs and steps. ' +
        "Rename it; --force does not rename it.",
    );
  });
});

describe("findReservedIds", () => {
  test("lists the user's jobs and steps whose ids use the tailor- prefix", () => {
    const edited = `${addStepAfterInstall(
      render.content,
      "tailor-deploy",
      "      - id: tailor-build-frontend\n        run: echo build\n",
    )}  tailor-lint:\n    runs-on: ubuntu-latest\n    steps:\n      - id: tailor-checkout\n        run: echo lint\n`;
    expect(findReservedIds(edited, render.generatedIds)).toEqual([
      "tailor-deploy/tailor-build-frontend",
      "tailor-lint",
      "tailor-lint/tailor-checkout",
    ]);
  });

  test("lists nothing for a freshly generated file", () => {
    expect(findReservedIds(render.content, render.generatedIds)).toEqual([]);
  });
});

describe("mergeUserContent", () => {
  const merge = (current: string, next: RenderResult, force = false) =>
    mergeUserContent({
      current,
      rendered: next.content,
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
    expect(computeManagedHash(content, next.generatedIds)).toBe(
      computeManagedHash(next.content, next.generatedIds),
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

  describe("an unmanaged top-level key the template writes", () => {
    const preview = renderPreviewWorkflow({
      workspaceName: "my-app",
      branch: "main",
      environment: "my-app",
      packageManager: "pnpm",
      region: "us-west",
    });
    const mergePreview = (current: string) =>
      mergeUserContent({
        current,
        rendered: preview.content,
        previousIds: preview.generatedIds,
        renderedIds: preview.generatedIds,
        force: false,
      });
    const concurrency = /^concurrency:\n(?: {2}.*\n)+/m;

    test("keeps the user's version instead of the template's", () => {
      const edited = preview.content.replace(
        concurrency,
        "concurrency:\n  group: mine-${{ github.ref }}\n",
      );
      expect(edited).not.toBe(preview.content);

      const { content } = mergePreview(edited);

      expect(content).toBe(edited);
      expect(computeManagedHash(content, preview.generatedIds)).toBe(
        computeManagedHash(preview.content, preview.generatedIds),
      );
    });

    test("adds the template's version when the file has none", () => {
      const without = preview.content.replace(concurrency, "");
      expect(without).not.toBe(preview.content);

      expect(mergePreview(without).content).toBe(preview.content);
    });

    test("is only the preview workflow's concurrency", () => {
      const unhashed = variants.flatMap(([name, { content, generatedIds }]) => {
        const hash = computeManagedHash(content, generatedIds);
        return Object.keys(parseDocument(content).toJS() as Record<string, unknown>)
          .filter((key) => {
            const edited = parseDocument(content);
            edited.set(key, "edited");
            return computeManagedHash(edited.toString(), generatedIds) === hash;
          })
          .map((key) => `${name}: ${key}`);
      });

      expect(unhashed).toEqual(["preview: concurrency"]);
    });
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
        previousIds: erd.generatedIds,
        renderedIds: render.generatedIds,
        force: true,
      }),
    ).toThrow(/after-erd.*tailor-erd-preview/);
  });

  test("keeps user nodes whose ids are Object.prototype keys", () => {
    const edited = `${render.content}  constructor:\n    runs-on: ubuntu-latest\n    steps:\n      - id: toString\n        run: echo hi\n`;
    expect(merge(edited, render).content).toBe(edited);
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

describe("environment on a managed job", () => {
  test("keeps a user environment on the changes detection job across regeneration", () => {
    const render = renderBranchWorkflow({ ...branchBase, workingDirectory: "apps/api" });
    const edited = render.content.replace(
      /( {2}tailor-changes:\n)/,
      "$1    environment: registry\n",
    );
    expect(edited).not.toBe(render.content);
    expect(computeManagedHash(edited, render.generatedIds)).toBe(
      computeManagedHash(render.content, render.generatedIds),
    );
    expect(
      mergeUserContent({
        current: edited,
        rendered: render.content,
        previousIds: render.generatedIds,
        renderedIds: render.generatedIds,
        force: false,
      }).content,
    ).toBe(edited);
  });

  const tag = renderTagWorkflow({
    workspaceName: "my-app",
    tagPattern: "v*",
    branch: "main",
    environment: "my-app",
    packageManager: "npm",
  });
  const tagHashOf = (content: string): string => computeManagedHash(content, tag.generatedIds);
  const withGuardEnvironment = (content: string): string =>
    content.replace(/( {2}tailor-tag-guard:\n {4}runs-on: .*\n)/, "$1    environment: registry\n");

  test("is ignored on a job the template writes without one", () => {
    const edited = withGuardEnvironment(tag.content);
    expect(edited).not.toBe(tag.content);
    expect(tagHashOf(edited)).toBe(tagHashOf(tag.content));
  });

  test("is not ignored on a job whose environment the template writes", () => {
    const edited = tag.content.replace(
      /( {2}tailor-plan:\n(?: {4}.*\n)*? {4})environment: my-app/,
      "$1environment: other",
    );
    expect(edited).not.toBe(tag.content);
    expect(tagHashOf(edited)).not.toBe(tagHashOf(tag.content));
  });

  test("is kept across regeneration on a job the template writes without one", () => {
    const edited = withGuardEnvironment(tag.content);
    expect(edited).not.toBe(tag.content);
    const { content } = mergeUserContent({
      current: edited,
      rendered: tag.content,
      previousIds: tag.generatedIds,
      renderedIds: tag.generatedIds,
      force: false,
    });
    expect(content).toBe(edited);
  });
});
