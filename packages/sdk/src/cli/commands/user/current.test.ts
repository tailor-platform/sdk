import * as fs from "node:fs";
import * as path from "pathe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writePlatformConfig } from "@/cli/shared/context";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { resetKeyringState } from "@/cli/shared/token-store";
import { currentCommand } from "./current";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-user-current-${Date.now()}-${Math.random()}`);

vi.mock("xdg-basedir", () => ({
  xdgConfig: xdgTempDir,
}));

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    setPassword() {}
    getPassword(): string | null {
      return null;
    }
    deletePassword() {}
  },
}));

const validUUID = "12345678-1234-4abc-8def-123456789012";

function captureStdout() {
  let output = "";
  const spy = vi.spyOn(console, "log").mockImplementation((chunk) => {
    output += String(chunk);
  });

  return {
    get output() {
      return output;
    },
    [Symbol.dispose]() {
      spy.mockRestore();
    },
  };
}

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("user current", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "u@example.com": {
          storage: "file",
          access_token: "token",
          refresh_token: "refresh",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
      },
      profiles: {
        dev: { user: "u@example.com", workspace_id: validUUID },
      },
      current_user: "u@example.com",
    });
  });

  afterEach(() => {
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("with jsonMode emits a parseable current-user object to stdout", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();

    await currentCommand.run({ json: true } as never);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual({ user: "u@example.com" });
  });
});
