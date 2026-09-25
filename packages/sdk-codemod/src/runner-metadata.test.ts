import { describe, expect, test } from "vitest";
import { createRunnerMetadata } from "./runner-metadata";

const packageInfo = {
  packageName: "@tailor-platform/sdk-codemod",
  packageVersion: "0.3.0-next.2",
};

describe("createRunnerMetadata", () => {
  test("includes the exact package identity", () => {
    const metadata = createRunnerMetadata({
      ...packageInfo,
      packageRoot: "/repo/packages/sdk-codemod",
      readGit: () => undefined,
      realpath: (value) => value,
    });

    expect(metadata).toEqual({
      packageName: "@tailor-platform/sdk-codemod",
      packageVersion: "0.3.0-next.2",
    });
  });

  test("includes the branch commit and local build command for a source checkout", () => {
    const metadata = createRunnerMetadata({
      ...packageInfo,
      packageRoot: "/repo/packages/sdk-codemod",
      readGit: (_cwd, args) => {
        if (args.join(" ") === "rev-parse --show-toplevel") return "/repo";
        if (args.join(" ") === "rev-parse --verify HEAD") return "abc123";
        return undefined;
      },
      realpath: (value) => value,
    });

    expect(metadata).toEqual({
      packageName: "@tailor-platform/sdk-codemod",
      packageVersion: "0.3.0-next.2",
      gitCommit: "abc123",
      localBuildCommand: "pnpm --dir packages/sdk-codemod build",
    });
  });

  test("does not report the consuming project's commit for an installed package", () => {
    const metadata = createRunnerMetadata({
      ...packageInfo,
      packageRoot: "/project/node_modules/@tailor-platform/sdk-codemod",
      readGit: (_cwd, args) => {
        if (args.join(" ") === "rev-parse --show-toplevel") return "/project";
        if (args.join(" ") === "rev-parse --verify HEAD") return "project-commit";
        return undefined;
      },
      realpath: (value) => value,
    });

    expect(metadata).toEqual({
      packageName: "@tailor-platform/sdk-codemod",
      packageVersion: "0.3.0-next.2",
    });
  });
});
