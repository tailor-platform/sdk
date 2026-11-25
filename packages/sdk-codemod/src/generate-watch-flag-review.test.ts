import { describe, expect, test } from "vitest";
import { reportedFiles as reportedFilesOf } from "./test-helpers/review-files";

const reportedFiles = (relativePath: string, source: string): Promise<string[]> =>
  reportedFilesOf("v2/generate-watch-flag", relativePath, source);

describe("generate --watch review", () => {
  test.each([
    ["a shell script", "run.sh", "tailor generate --watch\n"],
    ["the -W alias", "run.sh", "tailor generate -W\n"],
    [
      "a package.json script",
      "package.json",
      JSON.stringify({ scripts: { gen: "tailor generate --watch" } }),
    ],
    [
      "the second script of a compact package.json",
      "package.json",
      JSON.stringify({ scripts: { build: "tsc", gen: "tailor generate -W" } }),
    ],
    [
      "a backslash-newline continuation before --watch in a package.json script",
      "package.json",
      JSON.stringify({ scripts: { gen: "tailor generate \\\n  --watch" } }),
    ],
    [
      "the watch option of generate() in a node -e script of a package.json",
      "package.json",
      JSON.stringify({ scripts: { gen: 'node -e "generate({ watch: true })"' } }),
    ],
    [
      "a command outside scripts of a compact package.json",
      "package.json",
      JSON.stringify({ "lint-staged": { "*.ts": "tailor generate --watch" } }),
    ],
  ])("reports %s", async (_name, relativePath, source) => {
    expect(await reportedFiles(relativePath, source)).toEqual([relativePath]);
  });

  test.each([
    [
      "generate( and watch: in two scripts of a compact package.json",
      JSON.stringify({ scripts: { a: 'node -e "generate()"', b: "echo watch: on" } }),
    ],
    [
      "--watch of another command in the next script of a compact package.json",
      JSON.stringify({ scripts: { gen: "tailor generate", dev: "vite --watch" } }),
    ],
    [
      "-W of another command in the next script of a compact package.json",
      JSON.stringify({ scripts: { gen: "tailor generate", lint: "eslint -W" } }),
    ],
  ])("does not report %s", async (_name, source) => {
    expect(await reportedFiles("package.json", source)).toEqual([]);
  });
});
