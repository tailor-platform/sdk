import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createSelectionStore, projectDirectory } from "./selection-store";

let project: string;

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-studio-store-"));
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

describe("createSelectionStore", () => {
  test("has nothing remembered in a project it has never saved to", () => {
    expect(createSelectionStore(project).load()).toBeUndefined();
  });

  test("gives a new store the profile an earlier one saved for the same project", () => {
    createSelectionStore(project).save("dev-example");
    expect(createSelectionStore(project).load()).toBe("dev-example");
  });

  test("forgets the profile after the selection is cleared", () => {
    const store = createSelectionStore(project);
    store.save("dev-example");
    store.save(null);
    expect(store.load()).toBeUndefined();
  });

  test("keeps the projects apart", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-studio-store-"));
    createSelectionStore(project).save("test");
    expect(createSelectionStore(other).load()).toBeUndefined();
    fs.rmSync(other, { recursive: true, force: true });
  });

  test("treats a corrupt file as nothing remembered", () => {
    const file = path.join(project, "node_modules", ".cache", "tailor-studio", "selection.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    expect(createSelectionStore(project).load()).toBeUndefined();
  });
});

describe("projectDirectory", () => {
  test("is the directory of the config file the CLI passes, so a subdirectory shares its project's selection", () => {
    expect(
      projectDirectory({ TAILOR_CONFIG_PATH: "/work/app/tailor.config.ts" }, "/work/app/src/deep"),
    ).toBe("/work/app");
  });

  test("falls back to the working directory when the CLI passed no config file", () => {
    expect(projectDirectory({}, "/work/app")).toBe("/work/app");
  });

  test("treats an empty config path as none", () => {
    expect(projectDirectory({ TAILOR_CONFIG_PATH: "" }, "/work/app")).toBe("/work/app");
  });
});
