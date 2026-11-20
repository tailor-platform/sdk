import * as fs from "node:fs";
import { logger, withSourceLocation } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { setupAutofix, type AutofixSetupInputs } from "./autofix";
import { checkGitHub } from "./check";
import {
  setupTarget,
  type BranchSetupInputs,
  type PreviewSetupInputs,
  type SetupTargetOptions,
  type TagSetupInputs,
} from "./generate";
import {
  LOCK_VERSION,
  managedWorkflows,
  readLock,
  writeLock,
  type LockInputs,
  type LockTarget,
} from "./lock";
import { AUTOFIX_WORKFLOW_FILE, TEMPLATE_VERSION } from "./templates";
import { autofixSetupOptions } from "./test-helpers/autofix";
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
  test("branch: regenerates for github.com when the entry has no ghes", () => {
    const plan = planUpdate(lockTarget("branch", "my-app", { erdPreview: true }), common);

    expect(plan).toMatchObject({ kind: "branch", erdPreview: true, ghes: false });
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

  test("tag: keeps the tag unguarded when no branch was recorded", () => {
    const plan = planUpdate(lockTarget("tag", "my-app", { tagPattern: "v*" }), common);

    expect(plan).toMatchObject({ kind: "tag", branch: undefined });
  });

  test.each([null, "ready", "label"] as const)(
    "preview: regenerates with the recorded requirement (%s)",
    (require) => {
      const plan = planUpdate(
        lockTarget("preview", "my-app", {
          branch: "main",
          branchAutoDetected: false,
          region: "us-west",
          require,
        }),
        common,
      );

      expect(plan).toMatchObject({ kind: "preview", require: require ?? undefined });
    },
  );

  test.each([
    [false, "ready"],
    [true, "label"],
  ] as const)(
    "preview: reads a lock from before the requirement (requirePreviewLabel: %s) as %s",
    (requirePreviewLabel, expected) => {
      const plan = planUpdate(
        lockTarget("preview", "my-app", {
          branch: "main",
          branchAutoDetected: false,
          region: "us-west",
          requirePreviewLabel,
        }),
        common,
      );

      expect(plan).toMatchObject({ kind: "preview", require: expected });
    },
  );

  test("leaves seeding off for a target recorded without it", () => {
    const plan = planUpdate(lockTarget("branch", "my-app", {}), common);

    expect(plan.seed).toBeUndefined();
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

  test.each([
    ["it was auto-detected", { packageManagerAutoDetected: true }],
    ["the lock does not say how it was chosen", {}],
  ])("re-detects the package manager when %s", (_label, inputs) => {
    const plan = planUpdate(
      lockTarget("branch", "my-app", { packageManager: "npm", ...inputs }),
      common,
    );

    expect(plan.packageManager).toBeUndefined();
  });

  test("rejects an explicit package manager the lock records with an unsupported value", () => {
    expect(() =>
      planUpdate(
        lockTarget("branch", "my-app", {
          packageManager: "pnpm\nmalicious: true",
          packageManagerAutoDetected: false,
        }),
        common,
      ),
    ).toThrow(/unsupported package manager "pnpm\\nmalicious: true"/);
  });

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

  const writeSeedData = () => {
    fs.mkdirSync(path.join(testDir, "apps/api/seed/data/cogs"), { recursive: true });
    return {
      machineUserName: "admin",
      datasets: { preview: ["cogs"] },
      dataDir: path.join(testDir, "apps/api/seed/data"),
    };
  };

  const readGenerated = () => {
    const lock = readLock(testDir);
    if (!lock) throw new Error("Expected a lock file.");
    const files = managedWorkflows(lock).map(({ file }) =>
      fs.readFileSync(path.join(testDir, file), "utf-8"),
    );
    return { lock, files };
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

  // Every value differs from what setup uses when the option is left out.
  const autofixWithEveryOption = {
    provider: "securefix",
    securefixServerRepository: "securefix-server",
    codemod: "copilot",
    copilotAuth: "github-token",
    dir: ["apps/api", "apps/web"],
    packageManager: "yarn",
  } satisfies Required<AutofixSetupInputs>;
  const targetsWithEveryOption = [
    {
      kind: "branch",
      workspaceName: "api",
      dir: "apps/api",
      environment: "production",
      packageManager: "yarn",
      seed: { datasets: ["preview"] },
      branch: "release",
      extraPaths: ["modules/**"],
      erdPreview: true,
      ghes: true,
      restrictDispatch: true,
      migrationTest: true,
      migrationTestLabel: "run-migration-test",
      migrationTestEnvironment: "migration-source",
      splitPlanEnvironment: true,
    } satisfies Required<BranchSetupInputs>,
    {
      kind: "tag",
      workspaceName: "api",
      dir: "apps/api",
      environment: "production",
      packageManager: "yarn",
      seed: { datasets: ["preview"] },
      tagPattern: "release-*",
      branch: "release",
      restrictDispatch: true,
    } satisfies Required<TagSetupInputs>,
    {
      kind: "preview",
      workspaceName: "api",
      dir: "apps/api",
      environment: "preview",
      packageManager: "yarn",
      seed: { datasets: ["preview"] },
      branch: "release",
      extraPaths: ["modules/**"],
      region: "asia-northeast",
      require: "label",
    } satisfies Required<PreviewSetupInputs>,
  ];

  test.each(targetsWithEveryOption)(
    "$kind: regenerates a target with every option from what the lock records",
    async (inputs) => {
      writeAppConfig("apps/api");
      const seedSettings = writeSeedData();
      const run = {
        ...loaders,
        loadHasMigrations: async () => true,
        loadSeedSettings: async () => seedSettings,
      };
      await setupTarget({ ...inputs, force: false, outputDir: testDir, ...run });
      const generated = readGenerated();
      const [target] = generated.lock.targets;
      if (!target) throw new Error("Expected a lock target.");

      expect(planUpdate(target, common)).toEqual({ ...inputs, ...common });

      await setupUpdate({ force: false, outputDir: testDir, ...run });

      expect(readGenerated()).toEqual(generated);
    },
  );

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
    const generated = readGenerated();
    ageLock();

    await setupUpdate({ force: false, outputDir: testDir, ...loaders });

    const updated = readGenerated();
    expect(updated).toEqual(generated);
    expect(updated.lock.targets[0]?.inputs.apps?.map((app) => app.dir)).toEqual(multi.dir);
  });

  test("keeps seeding a target, and reports it once its dataset no longer resolves", async () => {
    writeAppConfig("apps/api");
    const settings = writeSeedData();
    await generate({
      kind: "branch",
      workspaceName: "api",
      dir: "apps/api",
      erdPreview: false,
      seed: { datasets: ["preview"] },
      loadSeedSettings: async () => settings,
    });
    ageLock();

    await setupUpdate({
      force: false,
      outputDir: testDir,
      ...loaders,
      loadSeedSettings: async () => settings,
    });

    expect(readLock(testDir)?.targets[0]).toMatchObject({
      templateVersion: TEMPLATE_VERSION,
      inputs: { seed: { datasets: ["preview"] } },
    });
    expect(
      fs.readFileSync(path.join(testDir, ".github/workflows/tailor-api.yml"), "utf-8"),
    ).toContain("seed apply --upsert --dataset preview");

    await expect(
      setupUpdate({
        force: false,
        outputDir: testDir,
        ...loaders,
        loadSeedSettings: async () => ({ ...settings, datasets: {} }),
      }),
    ).rejects.toThrow(/\[branch api\] Unknown seed dataset "preview"/);
  });

  test("keeps an explicit --package-manager and re-detects a detected one", async () => {
    writeAppConfig("apps/front");
    writeAppConfig("apps/api");
    await generate({
      kind: "branch",
      workspaceName: "front",
      dir: "apps/front",
      erdPreview: false,
      packageManager: "yarn",
    });
    await generate({ kind: "tag", workspaceName: "api", dir: "apps/api", tagPattern: "v*" });
    fs.rmSync(path.join(testDir, "pnpm-lock.yaml"));
    fs.writeFileSync(path.join(testDir, "bun.lock"), "");
    ageLock();

    await setupUpdate({ force: false, outputDir: testDir, ...loaders });

    expect(
      readLock(testDir)?.targets.map(({ inputs }) => [
        inputs.packageManager,
        inputs.packageManagerAutoDetected,
      ]),
    ).toEqual([
      ["yarn", false],
      ["bun", true],
    ]);
    const front = fs.readFileSync(
      path.join(testDir, ".github/workflows/tailor-front.yml"),
      "utf-8",
    );
    expect(front).toContain("package-manager: yarn");
  });

  test("lists a target whose package manager can no longer be detected", async () => {
    writeAppConfig("apps/api");
    await generate({ kind: "tag", workspaceName: "api", dir: "apps/api", tagPattern: "v*" });
    fs.rmSync(path.join(testDir, "pnpm-lock.yaml"));
    ageLock();

    await expect(setupUpdate({ force: false, outputDir: testDir, ...loaders })).rejects.toThrow(
      /\[tag api\] Could not detect the package manager/,
    );
  });

  test("lists a target's failure prefixed with the file it points at", async () => {
    writeAppConfig("apps/api");
    await generate({ kind: "branch", workspaceName: "api", dir: "apps/api", erdPreview: false });
    ageLock();
    const configPath = path.join(testDir, "apps/api/tailor.config.ts");

    await expect(
      setupUpdate({
        force: false,
        outputDir: testDir,
        ...loaders,
        loadHasMigrations: async () => {
          throw withSourceLocation(new Error("config is broken"), { file: configPath });
        },
      }),
    ).rejects.toThrow(`[branch api] ${path.relative(process.cwd(), configPath)}: config is broken`);
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
      /1 workflow\(s\) could not be updated[\s\S]*\[branch front\][\s\S]*--force/,
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

  test("regenerates a preview target recorded under a name longer than 50 characters, with a warning", async () => {
    using warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    writeAppConfig("apps/front");
    const name = "a".repeat(57);
    const file = `.github/workflows/tailor-${name}-preview.yml`;
    writeLock(testDir, {
      version: LOCK_VERSION,
      targets: [
        {
          ...lockTarget("preview", name, { branch: "main", dir: "apps/front", region: "us-west" }),
          file,
          templateVersion: TEMPLATE_VERSION - 1,
        },
      ],
    });

    await setupUpdate({ force: false, outputDir: testDir, ...loaders });

    expect(readLock(testDir)?.targets[0]?.templateVersion).toBe(TEMPLATE_VERSION);
    expect(fs.existsSync(path.join(testDir, file))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/from pull request #100\b/));
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
    expect(successSpy).toHaveBeenLastCalledWith(expect.stringMatching(/^Updated 5 workflow\(s\)/));
  });

  test("counts the cleanup workflow it adds to a preview target recorded without one", async () => {
    await generateMonorepo();
    const lock = readLock(testDir);
    if (!lock) throw new Error("Expected a lock.");
    writeLock(testDir, {
      ...lock,
      targets: lock.targets.map(({ cleanup: _cleanup, ...target }) => target),
    });
    fs.rmSync(path.join(testDir, ".github/workflows/tailor-front-preview-cleanup.yml"));
    using successSpy = vi.spyOn(logger, "success").mockImplementation(() => {});

    await setupUpdate({ force: false, outputDir: testDir, ...loaders });

    expect(successSpy).toHaveBeenLastCalledWith(expect.stringMatching(/^Updated 5 workflow\(s\)/));
  });

  test("counts both workflows of a preview target that cannot be updated", async () => {
    await generateMonorepo();
    fs.rmSync(path.join(testDir, "apps/front/tailor.config.ts"));

    await expect(setupUpdate({ force: false, outputDir: testDir, ...loaders })).rejects.toThrow(
      /^3 workflow\(s\) could not be updated \(2 of 5 updated\)/,
    );
  });

  test("errors when there is nothing to update", async () => {
    await expect(setupUpdate({ force: false, outputDir: testDir, ...loaders })).rejects.toThrow(
      /No managed workflows found/,
    );
  });

  test("regenerates the autofix workflow, even when the lock records no target", async () => {
    writeAppConfig("apps/api");
    await setupAutofix(
      autofixSetupOptions(testDir, {
        provider: "github-app",
        codemod: "deterministic",
        dir: "apps/api",
        packageManager: "yarn",
      }),
    );
    const lock = readLock(testDir);
    if (!lock?.autofix) throw new Error("Expected an autofix entry.");
    writeLock(testDir, {
      ...lock,
      autofix: { ...lock.autofix, templateVersion: TEMPLATE_VERSION - 1 },
    });
    fs.rmSync(path.join(testDir, AUTOFIX_WORKFLOW_FILE));
    using successSpy = vi.spyOn(logger, "success").mockImplementation(() => {});

    await setupUpdate({ force: false, outputDir: testDir, ...loaders });

    expect(readLock(testDir)?.autofix).toMatchObject({
      templateVersion: TEMPLATE_VERSION,
      inputs: {
        provider: "github-app",
        codemod: "deterministic",
        dirs: ["apps/api"],
        packageManager: "yarn",
      },
    });
    const content = fs.readFileSync(path.join(testDir, AUTOFIX_WORKFLOW_FILE), "utf-8");
    expect(content).toContain("working-directory: apps/api");
    expect(content).toContain("- id: tailor-codemod\n");
    expect(successSpy).toHaveBeenLastCalledWith(expect.stringMatching(/^Updated 1 workflow\(s\)/));
  });

  test("regenerates the autofix workflow with every option from what the lock records", async () => {
    writeAppConfig("apps/api");
    writeAppConfig("apps/web");
    await setupAutofix(autofixSetupOptions(testDir, autofixWithEveryOption));
    const generated = readGenerated();
    using _successSpy = vi.spyOn(logger, "success").mockImplementation(() => {});

    await setupUpdate({ force: false, outputDir: testDir, ...loaders });

    expect(readGenerated()).toEqual(generated);
  });

  test("refuses a Copilot auth it does not know", async () => {
    writeAppConfig("apps/api");
    await setupAutofix(autofixSetupOptions(testDir, { dir: "apps/api", codemod: "copilot" }));
    const lock = readLock(testDir);
    if (!lock?.autofix) throw new Error("Expected an autofix entry.");
    writeLock(testDir, {
      ...lock,
      autofix: { ...lock.autofix, inputs: { ...lock.autofix.inputs, copilotAuth: "oauth" } },
    });

    await expect(setupUpdate({ force: false, outputDir: testDir, ...loaders })).rejects.toThrow(
      /\[autofix\] \.github\/tailor\.lock records the unsupported Copilot auth "oauth"\. Re-run `tailor setup ci autofix` with --copilot-auth\./,
    );
  });

  test("refuses an autofix codemod mode it does not know", async () => {
    writeAppConfig("apps/api");
    await setupAutofix(autofixSetupOptions(testDir, { dir: "apps/api" }));
    const lock = readLock(testDir);
    if (!lock?.autofix) throw new Error("Expected an autofix entry.");
    writeLock(testDir, {
      ...lock,
      autofix: { ...lock.autofix, inputs: { ...lock.autofix.inputs, codemod: "gemini" } },
    });

    await expect(setupUpdate({ force: false, outputDir: testDir, ...loaders })).rejects.toThrow(
      /\[autofix\] \.github\/tailor\.lock records the unsupported codemod mode "gemini"\. Re-run `tailor setup ci autofix` with --codemod\./,
    );
  });

  test("lists the autofix workflow when it cannot be updated", async () => {
    await generateMonorepo();
    await setupAutofix(autofixSetupOptions(testDir, { dir: "apps/api" }));
    fs.rmSync(path.join(testDir, "apps/api/tailor.config.ts"));

    await expect(setupUpdate({ force: false, outputDir: testDir, ...loaders })).rejects.toThrow(
      /2 workflow\(s\) could not be updated \(4 of 6 updated\)[\s\S]*\[autofix\] tailor\.config\.ts not found/,
    );
  });
});
