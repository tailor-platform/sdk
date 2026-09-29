import { describe, expect, test } from "vitest";
import { planUpdate } from "./update";
import type { LockInputs, LockTarget } from "./lock";

const common = { force: false, outputDir: "/repo" };

const lockTarget = (
  kind: LockTarget["kind"],
  workspaceName: string,
  inputs: Partial<LockInputs>,
): LockTarget => ({
  kind,
  workspaceName,
  file: `.github/workflows/tailor-${workspaceName}.yml`,
  templateVersion: 1,
  inputs: {
    branch: null,
    tagPattern: null,
    environment: workspaceName,
    dir: ".",
    packageManager: "pnpm",
    ...inputs,
  },
  generatedIds: [],
  ejectedIds: [],
  contentHash: "managed-v1:sha256:0",
});

describe("planUpdate", () => {
  test("branch: regenerates with the recorded name, dir, environment, branch and flags", () => {
    const plan = planUpdate(
      lockTarget("branch", "my-app", {
        branch: "release",
        branchAutoDetected: false,
        environment: "production",
        dir: "apps/api",
        erdPreview: true,
        restrictDispatch: true,
      }),
      common,
    );

    expect(plan).toEqual({
      kind: "target",
      options: {
        kind: "branch",
        workspaceName: "my-app",
        dir: "apps/api",
        environment: "production",
        branch: "release",
        erdPreview: true,
        restrictDispatch: true,
        force: false,
        outputDir: "/repo",
      },
    });
  });

  test.each([true, undefined])(
    "branch: re-detects the default branch when branchAutoDetected is %s",
    (branchAutoDetected) => {
      const plan = planUpdate(
        lockTarget("branch", "my-app", { branch: "main", branchAutoDetected }),
        common,
      );

      expect(plan).toMatchObject({
        kind: "target",
        options: { kind: "branch", branch: undefined },
      });
    },
  );

  test("tag: regenerates with the recorded tag pattern, guard branch and restrict-dispatch", () => {
    const plan = planUpdate(
      lockTarget("tag", "my-app", {
        tagPattern: "release-*",
        branch: "main",
        restrictDispatch: true,
        environment: "production",
        dir: "apps/api",
      }),
      common,
    );

    expect(plan).toEqual({
      kind: "target",
      options: {
        kind: "tag",
        workspaceName: "my-app",
        dir: "apps/api",
        environment: "production",
        tagPattern: "release-*",
        branch: "main",
        restrictDispatch: true,
        force: false,
        outputDir: "/repo",
      },
    });
  });

  test("tag: keeps the tag unguarded when no branch was recorded", () => {
    const plan = planUpdate(lockTarget("tag", "my-app", { tagPattern: "v*" }), common);

    expect(plan).toMatchObject({ kind: "target", options: { kind: "tag", branch: undefined } });
  });

  test("preview: regenerates with the recorded region, label requirement and branch", () => {
    const plan = planUpdate(
      lockTarget("preview", "my-app", {
        branch: "develop",
        branchAutoDetected: false,
        region: "asia-northeast",
        requirePreviewLabel: true,
        environment: "preview",
        dir: "apps/api",
      }),
      common,
    );

    expect(plan).toEqual({
      kind: "target",
      options: {
        kind: "preview",
        workspaceName: "my-app",
        dir: "apps/api",
        environment: "preview",
        branch: "develop",
        region: "asia-northeast",
        requirePreviewLabel: true,
        force: false,
        outputDir: "/repo",
      },
    });
  });

  test("preview: re-detects the default branch when it was auto-detected", () => {
    const plan = planUpdate(
      lockTarget("preview", "my-app", {
        branch: "main",
        branchAutoDetected: true,
        region: "us-west",
      }),
      common,
    );

    expect(plan).toMatchObject({ kind: "target", options: { kind: "preview", branch: undefined } });
  });

  test("action: regenerates with the recorded name, dir and environment only", () => {
    const plan = planUpdate(
      lockTarget("action", "api", {
        environment: "production",
        dir: "apps/api",
        hasStaticWebsites: true,
      }),
      common,
    );

    expect(plan).toEqual({
      kind: "target",
      options: {
        kind: "action",
        workspaceName: "api",
        dir: "apps/api",
        environment: "production",
        force: false,
        outputDir: "/repo",
      },
    });
  });

  test("coordinate: rebuilds the --action values from the recorded grouping", () => {
    const plan = planUpdate(
      lockTarget("coordinate", "apps", {
        branch: "release",
        branchAutoDetected: false,
        environment: "production",
        restrictDispatch: true,
        actionGroups: [["web", "admin"], ["api"]],
      }),
      common,
    );

    expect(plan).toEqual({
      kind: "coordinate",
      options: {
        coordinatorName: "apps",
        coordinateKind: "branch",
        actions: ["web,admin", "api"],
        branch: "release",
        tagPattern: undefined,
        environment: "production",
        restrictDispatch: true,
        force: false,
        outputDir: "/repo",
      },
    });
  });

  test("coordinate: re-detects the default branch when it was auto-detected", () => {
    const plan = planUpdate(
      lockTarget("coordinate", "apps", {
        branch: "main",
        branchAutoDetected: true,
        actionGroups: [["api"]],
      }),
      common,
    );

    expect(plan).toMatchObject({ kind: "coordinate", options: { branch: undefined } });
  });

  test("coordinate: a recorded tag pattern makes it a tag coordinator", () => {
    const plan = planUpdate(
      lockTarget("coordinate", "apps", {
        tagPattern: "release-*",
        branch: "main",
        branchAutoDetected: false,
        actionGroups: [["api"]],
      }),
      common,
    );

    expect(plan).toMatchObject({
      kind: "coordinate",
      options: { coordinateKind: "tag", tagPattern: "release-*", branch: "main" },
    });
  });

  test("coordinate: skips an entry without a recorded grouping and tells how to record it", () => {
    const plan = planUpdate(
      lockTarget("coordinate", "apps", { actionDirs: ["apps/web", "apps/api"] }),
      common,
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: expect.stringContaining("tailor setup ci coordinate --name apps --action"),
    });
  });
});
