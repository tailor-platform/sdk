import { describe, expect, test } from "vitest";
import { selectionArgs, selectionEnv } from "./workspace-selection";

describe("selectionArgs", () => {
  test("passes only the profile, so the workspace is read from the profile each time it runs", () => {
    expect(selectionArgs({ profile: "test", workspaceId: "w" })).toEqual(["--profile=test"]);
  });

  test("passes only the workspace ID when no profile is selected", () => {
    expect(selectionArgs({ workspaceId: "w" })).toEqual(["--workspace-id=w"]);
  });

  test("binds a profile name that starts with a hyphen to its option", () => {
    expect(selectionArgs({ profile: "-x" })).toEqual(["--profile=-x"]);
  });

  test("is empty when nothing is selected", () => {
    expect(selectionArgs({})).toEqual([]);
  });
});

describe("selectionEnv", () => {
  const env = { TAILOR_PLATFORM_TOKEN: "startup-user-token", PATH: "/bin" };

  test("leaves out the inherited token while a profile is selected", () => {
    expect(selectionEnv({ profile: "test", workspaceId: "w" }, env)).toEqual({ PATH: "/bin" });
  });

  test("leaves out the platform the startup profile injected, so a profile without its own falls back to the default", () => {
    const injected = {
      TAILOR_PLATFORM_URL: "https://custom.example.com",
      TAILOR_PLATFORM_OAUTH2_CLIENT_ID: "custom-client",
      PATH: "/bin",
    };
    expect(selectionEnv({ profile: "test" }, injected)).toEqual({ PATH: "/bin" });
  });

  test("leaves out the startup workspace ID, which beats the workspace the selected profile points to", () => {
    const injected = { TAILOR_PLATFORM_WORKSPACE_ID: "startup-workspace", PATH: "/bin" };
    expect(selectionEnv({ profile: "test" }, injected)).toEqual({ PATH: "/bin" });
  });

  test("keeps the token when no profile is selected, so a token-only setup still works", () => {
    expect(selectionEnv({}, env)).toEqual(env);
  });

  test("does not change the environment it was given", () => {
    selectionEnv({ profile: "test" }, env);
    expect(env.TAILOR_PLATFORM_TOKEN).toBe("startup-user-token");
  });
});
