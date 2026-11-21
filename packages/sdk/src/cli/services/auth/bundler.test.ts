import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { extractInlineSourcemap } from "#/cli/shared/stack-trace";
import { makeTempDir } from "#/cli/shared/test-helpers/temp-dir";
import { assertDefined } from "#/utils/assert";
import { bundleAuthHooks } from "./bundler";
import type * as pkgTypes from "pkg-types";

type PkgTypesModule = typeof pkgTypes;

vi.mock("pkg-types", async (importOriginal) => {
  const original = await importOriginal<PkgTypesModule>();
  return { ...original, resolveTSConfig: vi.fn(async () => undefined) };
});

describe("bundleAuthHooks", () => {
  let tmpDir: string | undefined;

  aroundEach(async (runTest) => {
    await runTest();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeConfig(
    source = `
const handler = async ({ claims, idpConfigName, env }) => {
  return { claims, idpConfigName, environment: env.ENVIRONMENT };
};

export default {
  auth: { hooks: { beforeLogin: { handler } } },
};
`,
  ): string {
    tmpDir = makeTempDir("auth-bundler-test-");
    const configFile = path.join(tmpDir, "tailor.config.ts");
    fs.writeFileSync(configFile, source);
    return configFile;
  }

  test("calls the hook of the Auth service keyed by its name", async () => {
    const configFile = writeConfig(`
const handler = (name) => async ({ env }) => ({ name, env });

export default {
  auth: {
    "shop-auth": { hooks: { beforeLogin: { handler: handler("shop-auth") } } },
    "admin-auth": { hooks: { beforeLogin: { handler: handler("admin-auth") } } },
  },
};
`);

    const bundled = await bundleAuthHooks({
      configPath: configFile,
      authName: "admin-auth",
      authKey: "admin-auth",
      env: { REGION: "jp" },
      baseDir: path.dirname(configFile),
    });

    const bundleFile = path.join(path.dirname(configFile), "hook.mjs");
    fs.writeFileSync(
      bundleFile,
      assertDefined(bundled.get("auth-hook--admin-auth--before-login"), "hook bundle missing"),
    );
    const { main } = await import(pathToFileURL(bundleFile).href);
    await expect(main({ claims: {} })).resolves.toEqual({
      name: "admin-auth",
      env: { REGION: "jp" },
    });
  });

  test("injects the config env into the before-login hook args", async () => {
    const configFile = writeConfig();

    const bundled = await bundleAuthHooks({
      configPath: configFile,
      authName: "my-auth",
      env: { ENVIRONMENT: "staging", RETRIES: 3 },
      baseDir: path.dirname(configFile),
    });

    const code = bundled.get("auth-hook--my-auth--before-login");
    expect(code).toBeDefined();
    // The serialized env values are inlined into the generated wrapper
    expect(code).toContain("staging");
    expect(code).toContain("ENVIRONMENT");
  });

  test("bundles a before-login hook from a config that registers frontendPlugin", async () => {
    const frontendModule = path.resolve(
      import.meta.dirname,
      "../../../../../sdk-plugin-frontend/src/index.ts",
    );
    const configFile = writeConfig(`
import { frontendPlugin } from ${JSON.stringify(frontendModule)};
const handler = async ({ claims }) => ({ claims });
export const plugins = [frontendPlugin({ site: "web", distDir: "dist" })];
export default {
  auth: { hooks: { beforeLogin: { handler } } },
};
`);

    const bundled = await bundleAuthHooks({
      configPath: configFile,
      authName: "my-auth",
      baseDir: path.dirname(configFile),
    });

    expect(bundled.get("auth-hook--my-auth--before-login")).toBeDefined();
  });

  test("embeds the source text of installed packages in inline sourcemaps when asked to", async () => {
    const configFile = writeConfig(`
import { shout } from "auth-sourcemap-lib";

const handler = async ({ claims }) => ({ claims, shouted: shout("hi") });

export default {
  auth: { hooks: { beforeLogin: { handler } } },
};
`);
    const libDir = path.join(path.dirname(configFile), "node_modules", "auth-sourcemap-lib");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "package.json"),
      JSON.stringify({ name: "auth-sourcemap-lib", type: "module", main: "index.js" }),
    );
    fs.writeFileSync(
      path.join(libDir, "index.js"),
      "export const shout = (text) => text.toUpperCase() + 'INSTALLED_LIB_SOURCE';\n",
    );

    const bundled = await bundleAuthHooks({
      configPath: configFile,
      authName: "my-auth",
      baseDir: path.dirname(configFile),
      inlineSourcemap: true,
      inlineSourcemapDependencySources: true,
    });

    const traceMap = assertDefined(
      extractInlineSourcemap(
        assertDefined(bundled.get("auth-hook--my-auth--before-login"), "hook bundle missing"),
      ),
      "inline sourcemap missing",
    );
    expect(traceMap.sourcesContent?.some((text) => text?.includes("INSTALLED_LIB_SOURCE"))).toBe(
      true,
    );
  });

  test("injects an empty env object when none is provided", async () => {
    const configFile = writeConfig();

    const bundled = await bundleAuthHooks({
      configPath: configFile,
      authName: "my-auth",
      baseDir: path.dirname(configFile),
    });

    const code = bundled.get("auth-hook--my-auth--before-login");
    expect(code).toBeDefined();
    // The wrapper always defines an env binding, even when empty
    expect(code).toContain("env");
  });

  test("inlines TAILOR_APP_LOG_LEVEL references from config during bundling", async () => {
    const configFile = writeConfig(`
const handler = async () => ({ ok: true });

export default {
  logLevel: process.env.TAILOR_APP_LOG_LEVEL ?? "DEBUG",
  auth: { hooks: { beforeLogin: { handler } } },
};
`);

    const bundled = await bundleAuthHooks({
      configPath: configFile,
      authName: "my-auth",
      bundleLogLevel: "WARN",
      baseDir: path.dirname(configFile),
    });

    const code = bundled.get("auth-hook--my-auth--before-login");
    expect(code).toBeDefined();
    expect(code).not.toContain("process.env.TAILOR_APP_LOG_LEVEL");
  });

  test("uses the passed baseDir rather than deriving one from the config file's own directory", async () => {
    const configFile = writeConfig();
    const baseDir = makeTempDir("auth-bundler-basedir-");
    try {
      await bundleAuthHooks({
        configPath: configFile,
        authName: "my-auth",
        baseDir,
      });

      expect(resolveTSConfig).toHaveBeenCalledWith(baseDir);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("bundleAuthHooks date default", () => {
  test("folds the configured date default into the hook bundle", async () => {
    const tmpDir = makeTempDir("auth-date-default-");
    const configFile = path.join(tmpDir, "tailor.config.ts");
    fs.writeFileSync(
      configFile,
      `
const handler = async () => globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_DATE_DEFAULT;
export default { auth: { hooks: { beforeLogin: { handler } } } };
`,
    );
    try {
      const bundled = await bundleAuthHooks({
        configPath: configFile,
        authName: "my-auth",
        baseDir: tmpDir,
        dateDefault: "temporal",
      });
      expect(bundled.get("auth-hook--my-auth--before-login")).toMatch(/["'`]temporal["'`]/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
