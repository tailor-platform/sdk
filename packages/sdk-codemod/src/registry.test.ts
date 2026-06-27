import { describe, expect, test } from "vitest";
import { allCodemods, getApplicableCodemods } from "./registry";

describe("getApplicableCodemods", () => {
  test("returns codemods when upgrading across their version boundary", () => {
    const codemods = getApplicableCodemods("1.33.0", "2.0.0");
    expect(codemods.length).toBeGreaterThan(0);
    expect(codemods[0]!.id).toBe("v2/define-generators-to-plugins");
  });

  test("returns empty when both versions are before the codemod boundary", () => {
    expect(getApplicableCodemods("1.0.0", "1.5.0")).toEqual([]);
  });

  test("returns empty when both versions are after the codemod boundary", () => {
    expect(getApplicableCodemods("2.0.0", "3.0.0")).toEqual([]);
  });

  test("returns empty when from is already at the codemod boundary", () => {
    expect(getApplicableCodemods("2.0.0", "2.1.0")).toEqual([]);
  });

  test("throws for invalid semver versions", () => {
    expect(() => getApplicableCodemods("invalid", "2.0.0")).toThrow("Invalid fromVersion");
    expect(() => getApplicableCodemods("1.0.0", "invalid")).toThrow("Invalid toVersion");
  });

  test("apply-to-deploy scans source files with embedded CLI strings", () => {
    const applyToDeploy = getApplicableCodemods("1.67.1", "2.0.0").find(
      (codemod) => codemod.id === "v2/apply-to-deploy",
    );

    expect(applyToDeploy?.filePatterns).toEqual(
      expect.arrayContaining(["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"]),
    );
  });

  test("env-var-rename scans env files, CI configs, and source files", () => {
    const envVarRename = getApplicableCodemods("1.67.1", "2.0.0").find(
      (codemod) => codemod.id === "v2/env-var-rename",
    );

    expect(envVarRename?.filePatterns).toEqual(
      expect.arrayContaining([
        "**/.env",
        "**/.env.*",
        "**/*.{env,sh,bash,zsh,yml,yaml,json,md}",
        "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
      ]),
    );
    expect(envVarRename?.legacyPatterns).toContain("TAILOR_PLATFORM_SDK_CONFIG_PATH");
    expect(envVarRename?.legacyPatterns).toContain("TAILOR_TOKEN");
    expect(envVarRename?.sourceStringLegacyPatterns).toEqual(
      expect.arrayContaining(["PLATFORM_URL", "PLATFORM_OAUTH2_CLIENT_ID", "LOG_LEVEL"]),
    );
  });

  test("flags source files for runtime globals review", () => {
    const codemod = allCodemods.find((entry) => entry.id === "v2/runtime-globals-opt-in");

    expect(codemod?.filePatterns).toContain("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}");
    expect(codemod?.suspiciousPatterns).toContain("tailor.idp");
    expect(codemod?.suspiciousPatterns).toContain("tailor.secretmanager");
    expect(codemod?.suspiciousPatterns).toContain("tailor.authconnection");
    expect(codemod?.sourceStringSuspiciousPatterns).toContain("new tailor.idp.Client");
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) => pattern instanceof RegExp && pattern.test("const C = tailor.idp.Client;"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) =>
          pattern instanceof RegExp && pattern.test("await tailor.secretmanager.getSecret();"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) =>
          pattern instanceof RegExp && pattern.test("const { getSecret } = tailor.secretmanager;"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) =>
          pattern instanceof RegExp &&
          pattern.test("const getInvoker = tailor.context.getInvoker;"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) => pattern instanceof RegExp && pattern.test("const { upload } = tailordb.file;"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) => pattern instanceof RegExp && pattern.test("const e: TailorErrors = err;"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) =>
          pattern instanceof RegExp && pattern.test("type U = Promise<tailor.idp.User>;"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) =>
          pattern instanceof RegExp && pattern.test("type Ctor = typeof tailordb.Client;"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) => pattern instanceof RegExp && pattern.test("return tailordb.Client;"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) => pattern instanceof RegExp && pattern.test("foo(tailordb.Client);"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) =>
          pattern instanceof RegExp && pattern.test("type F = () => tailordb.QueryResult<User>;"),
      ),
    ).toBe(true);
    expect(
      codemod?.sourceStringSuspiciousPatterns?.some(
        (pattern) =>
          pattern instanceof RegExp &&
          pattern.test("type R = Promise<tailordb.QueryResult<User>>;"),
      ),
    ).toBe(true);
    expect(codemod?.prompt).toContain("@tailor-platform/sdk/runtime/globals");
  });

  test("leads runtime globals migration with the typed wrappers", () => {
    const codemod = allCodemods.find((entry) => entry.id === "v2/runtime-globals-opt-in");

    expect(codemod?.prompt).toContain('import { idp } from "@tailor-platform/sdk/runtime"');
    expect(codemod?.examples?.[0]?.after).toContain(
      'import { idp } from "@tailor-platform/sdk/runtime"',
    );
  });

  test("execute-script-arg reviews unresolved arg stringification patterns", () => {
    const executeScriptArg = getApplicableCodemods("1.67.1", "2.0.0").find(
      (codemod) => codemod.id === "v2/execute-script-arg",
    );
    const argPattern = executeScriptArg?.suspiciousPatterns?.find(
      (pattern): pattern is [string, string, RegExp] =>
        Array.isArray(pattern) && pattern[2] instanceof RegExp,
    )?.[2];

    expect(argPattern?.test("arg: value")).toBe(true);
    expect(argPattern?.test("arg : value")).toBe(true);
    expect(argPattern?.test("arg = value")).toBe(true);
    expect(argPattern?.test('"arg" : value')).toBe(true);
    expect(argPattern?.test('["arg"] = value')).toBe(true);
  });

  test("flags principal migration follow-ups for review", () => {
    const codemod = allCodemods.find((entry) => entry.id === "v2/principal-unify");

    expect(codemod?.suspiciousPatterns).toContain("context.user");
    expect(codemod?.suspiciousPatterns).toContain("caller?.");
    expect(codemod?.prompt).toContain("anonymous callers");
  });

  test("open-download-stream review is scoped to deprecated API names", () => {
    const openDownloadStream = getApplicableCodemods("1.67.1", "2.0.0").find(
      (codemod) => codemod.id === "v2/open-download-stream",
    );

    expect(openDownloadStream?.suspiciousPatterns).toEqual(
      expect.arrayContaining(["openDownloadStream", "openFileDownloadStream"]),
    );
  });
});
