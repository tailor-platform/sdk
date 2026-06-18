// Postbuild for the tsgo (file-by-file ESM) build. tsgo emits per-file JS + d.ts
// but leaves module specifiers exactly as written in source: extensionless
// relative imports, the `@/*` self-alias, and the `@tailor-proto/*` workspace
// alias. None of those are runnable as published ESM, so this script rewrites
// them and replicates the rest of what the old tsdown plugins did.
//
// Steps:
//   1. vendor the (already-compiled) @tailor-platform/tailor-proto sources into
//      dist/_proto so the workspace-only package travels with the publish
//   2. rename .js -> .mjs, .d.ts -> .d.mts, .js.map -> .mjs.map (fix map refs)
//   3. emit `.mjs` runtime modules for imported YAML files (tsgo skips .yml)
//   4. rewrite every module specifier in dist:
//        - `@/x`                       -> relative path into dist
//        - `@tailor-proto/tailor/v1/x` -> relative path into dist/_proto
//        - extensionless `./x`/`../x`  -> `./x.mjs` or `./x/index.mjs`
//        - `./x.js` / `./x.yml`        -> `./x.mjs` / `./x.yml.mjs`
//      directory specifiers resolve to `/index.mjs`.
//   5. prepend the node shebang to the CLI entrypoints
//   6. prepend the runtime/globals banner to configure/index.d.mts only
//   7. copy the ERD viewer assets into dist
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const srcDir = path.join(pkgRoot, "src");
const distDir = path.join(pkgRoot, "dist");
const protoSrcDir = path.resolve(pkgRoot, "..", "tailor-proto", "src");
const protoDistDir = path.join(distDir, "_proto");

/**
 * Recursively collect every file path under a directory.
 * @param dir - Directory to walk.
 * @returns Absolute paths of all files found.
 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// 1. Vendor tailor-proto. It is a private workspace package (not published),
//    whose generated .js/.d.ts only import @bufbuild/protobuf + @connectrpc/connect
//    (both SDK deps) plus its own relative files, so it can travel as-is.
function vendorProto() {
  rmSync(protoDistDir, { recursive: true, force: true });
  mkdirSync(protoDistDir, { recursive: true });
  cpSync(protoSrcDir, protoDistDir, {
    recursive: true,
    filter: (s) => {
      if (statSync(s).isDirectory()) return true;
      return s.endsWith(".js") || s.endsWith(".d.ts") || s.endsWith(".js.map");
    },
  });
}

// 2. Rename emitted files to the .mjs / .d.mts extensions, fixing sourcemap refs.
function renameEmitted(root) {
  for (const file of walk(root)) {
    if (file.endsWith(".js.map")) {
      const map = JSON.parse(readFileSync(file, "utf-8"));
      if (typeof map.file === "string") map.file = map.file.replace(/\.js$/, ".mjs");
      writeFileSync(file, JSON.stringify(map), "utf-8");
      renameSync(file, `${file.slice(0, -".js.map".length)}.mjs.map`);
    }
  }
  for (const file of walk(root)) {
    if (file.endsWith(".d.ts")) {
      renameSync(file, `${file.slice(0, -".d.ts".length)}.d.mts`);
    } else if (file.endsWith(".js")) {
      let content = readFileSync(file, "utf-8");
      content = content.replace(/(\/\/# sourceMappingURL=)(.*?)\.js\.map(\s*)$/, "$1$2.mjs.map$3");
      writeFileSync(file, content, "utf-8");
      renameSync(file, `${file.slice(0, -".js".length)}.mjs`);
    }
  }
}

// 3. YAML runtime modules: mirror every src/*.yml|*.yaml into dist as `<file>.mjs`.
function emitYamlModules() {
  for (const file of walk(srcDir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const rel = path.relative(srcDir, file);
    const target = path.join(distDir, `${rel}.mjs`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(
      target,
      `export default ${JSON.stringify(readFileSync(file, "utf-8"))};\n`,
      "utf-8",
    );
  }
}

// Resolve a now-extensionless / .mjs target path to an existing dist file,
// preferring `<base>.mjs` then `<base>/index.mjs`. Returns the posix relative
// specifier (with leading ./) or null when nothing matches.
function resolveSpecifier(fromFile, base) {
  const abs = path.resolve(path.dirname(fromFile), base);
  const candidates = [`${abs}.mjs`, path.join(abs, "index.mjs")];
  const isDecl = fromFile.endsWith(".d.mts");
  if (isDecl) {
    candidates.unshift(`${abs}.d.mts`, path.join(abs, "index.d.mts"));
  }
  for (const cand of candidates) {
    if (existsSync(cand)) {
      let chosen = cand;
      // For .d.mts resolution we still emit the runtime `.mjs` specifier.
      if (chosen.endsWith(".d.mts")) chosen = `${chosen.slice(0, -".d.mts".length)}.mjs`;
      let rel = path.relative(path.dirname(fromFile), chosen).split(path.sep).join("/");
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return rel;
    }
  }
  return null;
}

// 4. Rewrite all module specifiers across dist (.mjs and .d.mts).
function rewriteSpecifiers() {
  // Captures the leading keyword/paren, the quote, and the specifier.
  const re = /((?:from|import|export)\s*(?:\(\s*)?)(["'])([^"']+)\2/g;
  for (const file of walk(distDir)) {
    if (!file.endsWith(".mjs") && !file.endsWith(".d.mts")) continue;
    const content = readFileSync(file, "utf-8");
    const next = content.replace(re, (match, lead, quote, spec) => {
      const rewritten = rewriteSpec(file, spec);
      return rewritten === null ? match : `${lead}${quote}${rewritten}${quote}`;
    });
    if (next !== content) writeFileSync(file, next, "utf-8");
  }
}

function rewriteSpec(file, spec) {
  // @tailor-proto/tailor/v1/X -> dist/_proto/tailor/v1/X (resolve in vendored tree)
  if (spec.startsWith("@tailor-proto/")) {
    const sub = spec.slice("@tailor-proto/".length); // e.g. tailor/v1/service_pb
    const abs = path.join(protoDistDir, sub);
    return (
      resolveSpecifier(file, path.relative(path.dirname(file), abs).split(path.sep).join("/")) ??
      toRel(file, `${abs}.mjs`)
    );
  }
  // @/X -> dist/X
  if (spec.startsWith("@/")) {
    const abs = path.join(distDir, spec.slice("@/".length));
    return (
      resolveSpecifier(file, path.relative(path.dirname(file), abs).split(path.sep).join("/")) ??
      toRel(file, `${abs}.mjs`)
    );
  }
  // Relative specifiers, including the bare `.`/`..` directory forms.
  if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) {
    if (spec.endsWith(".yml")) return `${spec}.mjs`;
    if (spec.endsWith(".yaml")) return `${spec}.mjs`;
    const base = spec.endsWith(".js") ? spec.slice(0, -3) : spec;
    if (spec.endsWith(".json")) return null;
    return resolveSpecifier(file, base) ?? (spec.endsWith(".js") ? `${base}.mjs` : `${spec}.mjs`);
  }
  return null;
}

function toRel(fromFile, abs) {
  let rel = path.relative(path.dirname(fromFile), abs).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

// 5. Shebang + executable bit for CLI entrypoints (bin targets in package.json).
function addShebangs() {
  const shebang = "#!/usr/bin/env node\n";
  for (const rel of ["cli/index.mjs", "cli/skills.mjs"]) {
    const file = path.join(distDir, rel);
    const content = readFileSync(file, "utf-8");
    if (!content.startsWith("#!")) writeFileSync(file, shebang + content, "utf-8");
    chmodSync(file, 0o755);
  }
}

// 6. Banner on configure/index.d.mts only.
function addBanner() {
  const banner = '/// <reference types="@tailor-platform/sdk/runtime/globals" />\n';
  const file = path.join(distDir, "configure/index.d.mts");
  const content = readFileSync(file, "utf-8");
  if (!content.startsWith(banner)) writeFileSync(file, banner + content, "utf-8");
}

// 7. ERD viewer assets.
function copyErdAssets() {
  const source = path.join(srcDir, "cli/commands/tailordb/erd/viewer-assets");
  const target = path.join(distDir, "cli/erd-viewer-assets");
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
}

// Entry .js files tsgo must have emitted; their absence means tsgo failed to
// emit (as opposed to merely exiting non-zero on benign diagnostics).
const REQUIRED_ENTRIES = [
  "configure/index.js",
  "cli/index.js",
  "cli/skills.js",
  "runtime/index.js",
];

function main() {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error(`dist not found at ${distDir}; tsgo did not emit`);
  }
  for (const rel of REQUIRED_ENTRIES) {
    if (!existsSync(path.join(distDir, rel))) {
      throw new Error(`expected tsgo output missing: dist/${rel}; tsgo emit failed`);
    }
  }
  vendorProto();
  renameEmitted(distDir);
  emitYamlModules();
  rewriteSpecifiers();
  addShebangs();
  addBanner();
  copyErdAssets();
}

main();
