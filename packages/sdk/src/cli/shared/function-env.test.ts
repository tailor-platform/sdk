import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defineWorkspace } from "#/configure/config/workspace";
import { functionEnv } from "./function-env";
import { loadedWorkspace } from "./test-helpers/workspace-config";

describe("functionEnv", () => {
  let dir: string;
  const file = (relative: string) => {
    const filePath = path.join(dir, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "export default {};");
    return filePath;
  };

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "function-env-")));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function workspace() {
    return loadedWorkspace(
      defineWorkspace({
        env: { REGION: "us", URL: "https://example.com" },
        resolver: {
          "shop-api": {
            files: ["./resolvers/shop/*.ts"],
            env: { URL: "https://shop.example.com" },
          },
          "admin-api": { files: ["./resolvers/admin/*.ts"] },
        },
        executor: { files: ["./executors/*.ts"], env: { REGION: "eu" } },
        workflow: { files: ["./workflows/*.ts"], env: { REGION: "ap" } },
        apps: {},
      }),
      path.join(dir, "tailor.config.ts"),
    );
  }

  test("lays the override of the resolver namespace that holds the file over the root env", () => {
    expect(functionEnv(workspace(), "resolver", file("resolvers/shop/a.ts"))).toEqual({
      REGION: "us",
      URL: "https://shop.example.com",
    });
    expect(functionEnv(workspace(), "resolver", file("resolvers/admin/a.ts"))).toEqual({
      REGION: "us",
      URL: "https://example.com",
    });
  });

  test("lays the executor and workflow overrides over the root env", () => {
    expect(functionEnv(workspace(), "executor", file("executors/e.ts"))).toMatchObject({
      REGION: "eu",
    });
    expect(functionEnv(workspace(), "workflow-job", file("workflows/w.ts"))).toMatchObject({
      REGION: "ap",
    });
  });

  test("lays the workflow override over a job whose file the workflow files leave out, as deploy does", () => {
    expect(functionEnv(workspace(), "workflow-job", file("jobs/j.ts"))).toMatchObject({
      REGION: "ap",
    });
  });

  test("uses the root env for a file no service holds", () => {
    expect(functionEnv(workspace(), "plain", file("scripts/fix.ts"))).toEqual({
      REGION: "us",
      URL: "https://example.com",
    });
  });
});
