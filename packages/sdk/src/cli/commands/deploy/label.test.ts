import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { hasMatchingSdkVersion, isOwnedByApp, writeMetadataLabels } from "./label";
import type { MetadataLabelClient } from "./label";

describe("isOwnedByApp", () => {
  test("returns false when labels are undefined", () => {
    expect(isOwnedByApp(undefined, "my-app", "id-1")).toBe(false);
  });

  test("returns true when sdk-app-id matches the provided id with app- prefix applied", () => {
    const labels = { "sdk-app-id": "app-id-1", "sdk-name": "different-name" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(true);
  });

  test("returns false when sdk-app-id mismatches even if name matches", () => {
    const labels = { "sdk-app-id": "app-id-2", "sdk-name": "my-app" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(false);
  });

  test("falls back to sdk-name when no app id is provided", () => {
    const labels = { "sdk-name": "my-app" };
    expect(isOwnedByApp(labels, "my-app", undefined)).toBe(true);
  });

  test("falls back to sdk-name when label has no sdk-app-id", () => {
    const labels = { "sdk-name": "my-app" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(true);
  });

  test("returns false when neither id nor name matches", () => {
    const labels = { "sdk-name": "other-app", "sdk-app-id": "app-id-2" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(false);
  });
});

describe("hasMatchingSdkVersion", () => {
  test("returns true when both labels carry the same sdk-version", () => {
    expect(hasMatchingSdkVersion({ "sdk-version": "v1-0-0" }, { "sdk-version": "v1-0-0" })).toBe(
      true,
    );
  });

  test("returns false when sdk-version differs", () => {
    expect(hasMatchingSdkVersion({ "sdk-version": "v1-0-0" }, { "sdk-version": "v1-1-0" })).toBe(
      false,
    );
  });

  test("returns false when one side is missing the label", () => {
    expect(hasMatchingSdkVersion(undefined, { "sdk-version": "v1-0-0" })).toBe(false);
    expect(hasMatchingSdkVersion({ "sdk-version": "v1-0-0" }, undefined)).toBe(false);
  });
});

describe("writeMetadataLabels", () => {
  function createClient(labels: Record<string, string> | undefined) {
    return {
      getMetadata: vi.fn().mockResolvedValue(labels ? { metadata: { labels } } : {}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } satisfies MetadataLabelClient & {
      getMetadata: ReturnType<typeof vi.fn>;
      setMetadata: ReturnType<typeof vi.fn>;
    };
  }

  test("keeps labels the caller did not mention", async () => {
    const client = createClient({ keep: "yes", "sdk-name": "old-app" });

    await writeMetadataLabels(client, { trn: "trn:x", labels: { "sdk-name": "new-app" } });

    expect(client.setMetadata).toHaveBeenCalledWith({
      trn: "trn:x",
      labels: { keep: "yes", "sdk-name": "new-app" },
    });
  });

  test("reads the labels at write time, not from state passed in", async () => {
    // A label written by someone else after this process last read the resource
    // survives, which is the whole point of going through this helper.
    const client = createClient({ "written-by-another-writer": "value" });

    await writeMetadataLabels(client, { trn: "trn:x", labels: { mine: "value" } });

    expect(client.getMetadata).toHaveBeenCalledWith({ trn: "trn:x" });
    expect(client.setMetadata).toHaveBeenCalledWith({
      trn: "trn:x",
      labels: { "written-by-another-writer": "value", mine: "value" },
    });
  });

  test("deletes only the keys named in remove", async () => {
    const client = createClient({ "sdk-name": "app", "sdk-version": "v1-0-0", custom: "value" });

    await writeMetadataLabels(client, {
      trn: "trn:x",
      remove: ["sdk-name", "sdk-version"],
    });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: "trn:x", labels: { custom: "value" } });
  });

  test("applies remove after labels, so a key can be set and dropped in one call", async () => {
    const client = createClient({ stale: "value" });

    await writeMetadataLabels(client, {
      trn: "trn:x",
      labels: { fresh: "value", stale: "rewritten" },
      remove: ["stale"],
    });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: "trn:x", labels: { fresh: "value" } });
  });

  test("treats a resource with no metadata yet as having no labels", async () => {
    const client = createClient(undefined);

    await writeMetadataLabels(client, { trn: "trn:x", labels: { mine: "value" } });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: "trn:x", labels: { mine: "value" } });
  });

  test.each([
    ["the labels are already set to the requested values", { labels: { keep: "yes" } }],
    ["the keys to remove are not there", { remove: ["gone"] }],
  ])("does not write when %s", async (_name, change) => {
    const client = createClient({ keep: "yes" });

    await writeMetadataLabels(client, { trn: "trn:x", ...change });

    expect(client.getMetadata).toHaveBeenCalledWith({ trn: "trn:x" });
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test.each([
    ["nothing is requested", {}],
    ["the requested change is empty", { labels: {}, remove: [] }],
  ])("does not touch the resource when %s", async (_name, change) => {
    const client = createClient({ keep: "yes" });

    await writeMetadataLabels(client, { trn: "trn:x", ...change });

    expect(client.getMetadata).not.toHaveBeenCalled();
    expect(client.setMetadata).not.toHaveBeenCalled();
  });
});

describe("setMetadata call sites", () => {
  const srcDir = path.resolve(__dirname, "../../..");

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      // Service tests create and delete temporary sources under dot-directories
      // while this runs; they are fixtures, not call sites.
      if (entry.name.startsWith(".")) return [];
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
    });
  }

  function callsSetMetadata(file: string): boolean {
    try {
      // \s so a call the formatter wrapped across lines still counts.
      return /\.\s*setMetadata\s*\(/.test(fs.readFileSync(file, "utf-8"));
    } catch {
      // Raced with a test that removed its own fixture; nothing to check.
      return false;
    }
  }

  test("only the helper calls setMetadata directly", () => {
    // SetMetadata replaces the whole label map, so a call that does not re-read
    // first can delete labels written since this process last looked. Route new
    // writes through writeMetadataLabels instead of adding a call site here.
    const offenders = sourceFiles(srcDir)
      .filter(callsSetMetadata)
      .map((file) => path.relative(srcDir, file))
      .filter((file) => file !== "cli/commands/deploy/label.ts");

    expect(offenders).toEqual([]);
  });
});
