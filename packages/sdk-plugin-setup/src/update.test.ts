import * as fs from "node:fs";
import { logger } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { checkGitHub } from "./check";
import { setupTarget, type SetupTargetOptions } from "./generate";
import { readLock, writeLock, type LockInputs, type LockTarget } from "./lock";
import { TEMPLATE_VERSION } from "./templates";
import { tempDir } from "./test-helpers/temp-dir";
import { planUpdate, setupUpdate } from "./update";

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
      kind: "branch",
      workspaceName: "my-app",
      dir: "apps/api",
      environment: "production",
      branch: "release",
      erdPreview: true,
      restrictDispatch: true,
      force: false,
      outputDir: "/repo",
    });
  });

  test("branch: re-detects the default branch when it was auto-detected", () => {
    const plan = planUpdate(
      lockTarget("branch", "my-app", { branch: "main", branchAutoDetected: true }),
      common,
    );

    expect(plan).toMatchObject({ kind: "branch", branch: undefined });
  });

  test("branch: keeps the recorded branch when the lock does not say it was auto-detected", () => {
    const plan = planUpdate(lockTarget("branch", "my-app", { branch: "staging" }), common);

    expect(plan).toMatchObject({ kind: "branch", branch: "staging" });
  });

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
      kind: "tag",
      workspaceName: "my-app",
      dir: "apps/api",
      environment: "production",
      tagPattern: "release-*",
      branch: "main",
      restrictDispatch: true,
      force: false,
      outputDir: "/repo",
    });
  });

  test("tag: keeps the tag unguarded when no branch was recorded", () => {
    const plan = planUpdate(lockTarget("tag", "my-app", { tagPattern: "v*" }), common);

    expect(plan).toMatchObject({ kind: "tag", branch: undefined });
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
      kind: "preview",
      workspaceName: "my-app",
      dir: "apps/api",
      environment: "preview",
      branch: "develop",
      region: "asia-northeast",
      requirePreviewLabel: true,
      includeDrafts: false,
      force: false,
      outputDir: "/repo",
    });
  });

  test("preview: regenerates with the recorded draft setting", () => {
    const plan = planUpdate(
      lockTarget("preview", "my-app", {
        branch: "main",
        branchAutoDetected: false,
        region: "us-west",
        includeDrafts: true,
      }),
      common,
    );

    expect(plan).toMatchObject({ kind: "preview", includeDrafts: true });
  });

  test("preview: skips drafts when the lock predates the draft setting", () => {
    const plan = planUpdate(
      lockTarget("preview", "my-app", {
        branch: "main",
        branchAutoDetected: false,
        region: "us-west",
      }),
      common,
    );

    expect(plan).toMatchObject({ kind: "preview", includeDrafts: false });
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

    expect(plan).toMatchObject({ kind: "preview", branch: undefined });
  });

  test.each(["branch", "preview"] as const)(
    "%s: regenerates a multi-directory target with every recorded app directory and extra path",
    (kind) => {
      const plan = planUpdate(
        lockTarget(kind, "erp", {
          dir: ".",
          apps: [{ dir: "apps/erp/backend" }, { dir: "apps/users/backend" }],
          paths: ["modules/**"],
          region: "us-west",
        }),
        common,
      );

      expect(plan).toMatchObject({
        dir: ["apps/erp/backend", "apps/users/backend"],
        extraPaths: ["modules/**"],
      });
    },
  );

  test("tag: regenerates a multi-directory target with every recorded app directory", () => {
    const plan = planUpdate(
      lockTarget("tag", "erp", {
        dir: ".",
        tagPattern: "v*",
        apps: [{ dir: "apps/erp/backend" }, { dir: "apps/users/backend" }],
      }),
      common,
    );

    expect(plan).toMatchObject({ dir: ["apps/erp/backend", "apps/users/backend"] });
  });
});

describe("setupUpdate", () => {
  let testDir = "";
  aroundEach(async (runTest) => {
    using tmp = tempDir("setup-update-");
    testDir = tmp.dir;
    fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "");
    await runTest();
  });

  const loaders = {
    gitRunner: () => "origin/main",
    loadConfigId: async () => undefined,
    loadErdNamespaces: async () => ["tailordb"],
    loadHasMigrations: async () => false,
    loadHasSeeds: async () => false,
  };

  const writeAppConfig = (dir: string): void => {
    fs.mkdirSync(path.join(testDir, dir), { recursive: true });
    fs.writeFileSync(path.join(testDir, dir, "tailor.config.ts"), "export default {};\n");
  };

  const generate = async (
    options: Partial<SetupTargetOptions> & Pick<SetupTargetOptions, "kind">,
  ): Promise<void> => {
    await setupTarget({
      dir: ".",
      force: false,
      outputDir: testDir,
      ...loaders,
      ...options,
    } as SetupTargetOptions);
  };

  const ageLock = (): void => {
    const lock = readLock(testDir);
    if (!lock) throw new Error("Expected a lock file.");
    writeLock(testDir, {
      ...lock,
      targets: lock.targets.map((t) => ({ ...t, templateVersion: TEMPLATE_VERSION - 1 })),
    });
  };

  const handEdit = (file: string): void => {
    const abs = path.join(testDir, file);
    fs.writeFileSync(
      abs,
      fs
        .readFileSync(abs, "utf-8")
        .replace("cancel-in-progress: false", "cancel-in-progress: true"),
    );
  };

  const generateMonorepo = async (): Promise<void> => {
    writeAppConfig("apps/front");
    writeAppConfig("apps/admin");
    writeAppConfig("apps/api");
    await generate({ kind: "branch", workspaceName: "front", dir: "apps/front", erdPreview: true });
    await generate({
      kind: "preview",
      workspaceName: "front",
      dir: "apps/front",
      region: "us-west",
    });
    await generate({
      kind: "branch",
      workspaceName: "admin",
      dir: "apps/admin",
      erdPreview: false,
    });
    await generate({ kind: "tag", workspaceName: "api", dir: "apps/api", tagPattern: "v*" });
  };

  test("regenerates every target with the current template so check reports no drift", async () => {
    await generateMonorepo();
    ageLock();

    await setupUpdate({ force: false, outputDir: testDir, ...loaders });

    expect(readLock(testDir)?.targets.map((t) => t.templateVersion)).toEqual(
      Array(4).fill(TEMPLATE_VERSION),
    );
    vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_ID", "ws");
    try {
      await expect(checkGitHub({ outputDir: testDir, ...loaders })).resolves.toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("keeps the app directories and extra paths of multi-directory branch and preview targets", async () => {
    writeAppConfig("apps/erp/backend");
    writeAppConfig("apps/users/backend");
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({ private: true, devDependencies: { "@tailor-platform/sdk": "1.0.0" } }),
    );
    const multi = {
      workspaceName: "erp",
      dir: ["apps/erp/backend", "apps/users/backend"],
      extraPaths: ["modules/**"],
    };
    await generate({ kind: "branch", erdPreview: false, ...multi });
    await generate({ kind: "preview", region: "us-west", ...multi });
    const before = readLock(testDir)?.targets.map((t) => t.inputs);
    ageLock();

    await setupUpdate({ force: false, outputDir: testDir, ...loaders });

    const after = readLock(testDir)?.targets.map((t) => t.inputs);
    expect(after?.map((inputs) => [inputs.apps, inputs.paths])).toEqual(
      before?.map((inputs) => [inputs.apps, inputs.paths]),
    );
    expect(after?.[0]?.apps?.map((app) => app.dir)).toEqual(multi.dir);
  });

  test("keeps going past a hand-edited target and lists it as not updated", async () => {
    await generateMonorepo();
    ageLock();
    handEdit(".github/workflows/tailor-front.yml");
    const edited = fs.readFileSync(
      path.join(testDir, ".github/workflows/tailor-front.yml"),
      "utf-8",
    );

    await expect(setupUpdate({ force: false, outputDir: testDir, ...loaders })).rejects.toThrow(
      /1 target\(s\) could not be updated[\s\S]*\[branch front\][\s\S]*--force/,
    );

    const versions = Object.fromEntries(
      (readLock(testDir)?.targets ?? []).map((t) => [
        `${t.kind} ${t.workspaceName}`,
        t.templateVersion,
      ]),
    );
    expect(versions).toEqual({
      "branch front": TEMPLATE_VERSION - 1,
      "preview front": TEMPLATE_VERSION,
      "branch admin": TEMPLATE_VERSION,
      "tag api": TEMPLATE_VERSION,
    });
    expect(fs.readFileSync(path.join(testDir, ".github/workflows/tailor-front.yml"), "utf-8")).toBe(
      edited,
    );
  });

  test("lists a CLI error's suggestion under its target, labelled as in `setup ci`", async () => {
    writeAppConfig("apps/front");
    await generate({
      kind: "branch",
      workspaceName: "front",
      dir: "apps/front",
      erdPreview: false,
    });

    await expect(
      setupUpdate({
        force: false,
        outputDir: testDir,
        ...loaders,
        loadConfigId: async () => "c98794dd-9bf1-480f-a5c9-bf92b3679d42",
      }),
    ).rejects.toThrow(
      /\[branch front\] [^\n]+\n {4}Suggestion: Neither can be chosen automatically/,
    );
  });

  test("--force resets hand edits to SDK-managed parts of every target", async () => {
    await generateMonorepo();
    handEdit(".github/workflows/tailor-front.yml");

    await setupUpdate({ force: true, outputDir: testDir, ...loaders });

    expect(
      fs.readFileSync(path.join(testDir, ".github/workflows/tailor-front.yml"), "utf-8"),
    ).toContain("cancel-in-progress: false");
  });

  test("prints one summary instead of per-target next steps", async () => {
    await generateMonorepo();
    using infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    using successSpy = vi.spyOn(logger, "success").mockImplementation(() => {});

    await setupUpdate({ force: false, outputDir: testDir, ...loaders });

    expect(infoSpy).not.toHaveBeenCalledWith("Next steps:");
    expect(successSpy).toHaveBeenLastCalledWith(expect.stringMatching(/^Updated 4 target\(s\)/));
  });

  test("errors when there is nothing to update", async () => {
    await expect(setupUpdate({ force: false, outputDir: testDir, ...loaders })).rejects.toThrow(
      /No managed workflows found/,
    );
  });
});
