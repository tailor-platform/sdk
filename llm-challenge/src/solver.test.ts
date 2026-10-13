import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createSolverRuntime } from "./solver";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("solver runtime", () => {
  test("a host Claude runtime needs no OAuth token and verifies on the host", async () => {
    const runtime = await createSolverRuntime("claude", packageRoot, "host");

    expect(runtime).toMatchObject({ agent: "claude", kind: "host", verifier: "host" });
  });

  test("a Codex runtime runs and verifies in Podman", async () => {
    const runtime = await createSolverRuntime("codex", packageRoot, "podman");

    expect(runtime).toMatchObject({ agent: "codex", kind: "podman", verifier: "podman" });
  });
});
