import { describe, expect, test, vi } from "vitest";
import { createAccounts } from "./accounts";

const sdk = vi.hoisted(() => ({
  createProfile: vi.fn(async () => ({})),
  listLoggedInUsers: vi.fn(async () => ["me@example.com"]),
  listWorkspacesOfUser: vi.fn(async () => [{ id: "w1", name: "dev", organizationId: "o" }]),
}));

vi.mock("@tailor-platform/sdk/cli", () => sdk);

const PLATFORM = { platformUrl: "https://platform.example", oauth2ClientId: "client" };

describe("createAccounts", () => {
  test("lists the users of the startup platform", async () => {
    await createAccounts(PLATFORM).listUsers();
    expect(sdk.listLoggedInUsers).toHaveBeenCalledWith(PLATFORM);
  });

  test("lists the workspaces of a user on the startup platform, keeping only id and name", async () => {
    const workspaces = await createAccounts(PLATFORM).listWorkspaces("me@example.com");
    expect([workspaces, sdk.listWorkspacesOfUser.mock.calls[0]]).toEqual([
      [{ id: "w1", name: "dev" }],
      ["me@example.com", PLATFORM],
    ]);
  });

  test("stores the startup platform in the profile it creates", async () => {
    await createAccounts(PLATFORM).createProfile({
      name: "p",
      user: "me@example.com",
      workspaceId: "w1",
    });
    expect(sdk.createProfile).toHaveBeenCalledWith({
      name: "p",
      user: "me@example.com",
      workspaceId: "w1",
      ...PLATFORM,
    });
  });

  test("creates a profile without platform fields when the environment names no platform", async () => {
    sdk.createProfile.mockClear();
    await createAccounts(undefined).createProfile({ name: "p", user: "u", workspaceId: "w1" });
    expect(sdk.createProfile).toHaveBeenCalledWith({ name: "p", user: "u", workspaceId: "w1" });
  });
});
