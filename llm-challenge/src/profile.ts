import { promises as fs } from "node:fs";
import path from "node:path";
import { runCommand } from "./process";

const NO_DOCS_REMOVE_ENTRIES = [
  "README.md",
  "CHANGELOG.md",
  "docs",
  "examples",
  "agent-skills",
  "skills",
];
const JS_DOC_STRIP_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts", ".js", ".mjs", ".cjs"];
// macOS `tar` otherwise stores xattrs/AppleDouble (`._*`, LIBARCHIVE.xattr) into
// the repacked tarball; COPYFILE_DISABLE suppresses it and is ignored by GNU tar.
const TAR_ENV = { COPYFILE_DISABLE: "1" };

export async function createNoDocsTarball(
  fullTarballPath: string,
  outputTarballPath: string,
  tempRoot: string,
): Promise<void> {
  const unpackRoot = path.join(tempRoot, "no-docs-unpack");
  await fs.rm(unpackRoot, { recursive: true, force: true });
  await fs.mkdir(unpackRoot, { recursive: true });
  await runCommand("tar", ["-xzf", fullTarballPath, "-C", unpackRoot], { env: TAR_ENV });
  const packageDir = path.join(unpackRoot, "package");
  await applyNoDocsProfile(packageDir);
  await fs.rm(outputTarballPath, { force: true });
  await runCommand("tar", ["-czf", outputTarballPath, "-C", unpackRoot, "package"], {
    env: TAR_ENV,
  });
}

export async function applyNoDocsProfile(packageDir: string): Promise<void> {
  for (const entry of NO_DOCS_REMOVE_ENTRIES) {
    await fs.rm(path.join(packageDir, entry), { recursive: true, force: true });
  }

  for await (const filePath of walkFiles(packageDir)) {
    if (filePath.endsWith(".map")) {
      await fs.rm(filePath);
    } else if (shouldStripJsDoc(filePath)) {
      const original = await fs.readFile(filePath, "utf8");
      const stripped = stripJsDocBlocks(original);
      if (stripped !== original) {
        await fs.writeFile(filePath, stripped);
      }
    }
  }
}

export function stripJsDocBlocks(contents: string): string {
  let stripped = "";
  let index = 0;

  while (index < contents.length) {
    const char = contents[index];
    const next = contents[index + 1];
    const third = contents[index + 2];

    if (char === "/" && next === "/") {
      const end = contents.indexOf("\n", index + 2);
      const lineEnd = end === -1 ? contents.length : end + 1;
      stripped += contents.slice(index, lineEnd);
      index = lineEnd;
      continue;
    }
    if (char === "/" && next === "*" && third === "*") {
      const end = contents.indexOf("*/", index + 3);
      index = end === -1 ? contents.length : end + 2;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = contents.indexOf("*/", index + 2);
      const commentEnd = end === -1 ? contents.length : end + 2;
      stripped += contents.slice(index, commentEnd);
      index = commentEnd;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const result = readQuoted(contents, index, char);
      stripped += result.value;
      index = result.end;
      continue;
    }

    stripped += char;
    index += 1;
  }

  return stripped;
}

function shouldStripJsDoc(filePath: string): boolean {
  return JS_DOC_STRIP_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

function readQuoted(
  contents: string,
  start: number,
  quote: "'" | '"' | "`",
): { value: string; end: number } {
  let index = start + 1;
  while (index < contents.length) {
    const char = contents[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (char === quote) {
      break;
    }
  }
  return { value: contents.slice(start, index), end: index };
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
