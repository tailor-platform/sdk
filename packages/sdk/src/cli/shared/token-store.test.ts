import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isKeyringAvailable,
  loadKeyringTokens,
  saveKeyringTokens,
  deleteKeyringTokens,
  resetKeyringState,
} from "./token-store";

vi.mock("./logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

const passwords = new Map<string, string>();

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    private key: string;
    constructor(service: string, account: string) {
      this.key = `${service}:${account}`;
    }
    setPassword(password: string) {
      passwords.set(this.key, password);
    }
    getPassword(): string | null {
      return passwords.get(this.key) ?? null;
    }
    deletePassword() {
      if (!passwords.has(this.key)) {
        throw new Error("not found");
      }
      passwords.delete(this.key);
    }
  },
}));

describe("token-store", () => {
  beforeEach(() => {
    resetKeyringState();
    passwords.clear();
  });

  describe("isKeyringAvailable", () => {
    it("returns true when keyring is functional", async () => {
      expect(await isKeyringAvailable()).toBe(true);
    });
  });

  describe("keyring operations", () => {
    it("saves, loads, and deletes tokens", async () => {
      const user = "test-user";
      await saveKeyringTokens(user, {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
      });

      const tokens = await loadKeyringTokens(user);
      expect(tokens).toEqual({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
      });

      await deleteKeyringTokens(user);
      expect(await loadKeyringTokens(user)).toBeUndefined();
    });

    it("saves tokens without refreshToken (machine user)", async () => {
      const user = "test-machine";
      await saveKeyringTokens(user, { accessToken: "machine-token" });

      const tokens = await loadKeyringTokens(user);
      expect(tokens).toEqual({ accessToken: "machine-token" });
    });

    it("returns undefined for non-existent entry", async () => {
      expect(await loadKeyringTokens("non-existent-user")).toBeUndefined();
    });

    it("does not throw when deleting non-existent entry", async () => {
      await expect(deleteKeyringTokens("non-existent-user")).resolves.not.toThrow();
    });
  });
});
