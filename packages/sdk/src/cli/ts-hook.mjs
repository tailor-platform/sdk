import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
// Node.js module hook: TypeScript resolver + type stripper via amaro.
// Registered programmatically so the CLI can import user .ts files without
// requiring --experimental-strip-types at process startup.
import { transformSync } from "amaro";

const TS_EXTENSIONS = [".ts", ".tsx", ".mts"];
const JS_TO_TS = new Map([
  [".js", ".ts"],
  [".jsx", ".tsx"],
  [".mjs", ".mts"],
]);

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw err;

    const lastSegment = specifier.split("/").pop() ?? "";
    if (!lastSegment.includes(".")) {
      for (const ext of TS_EXTENSIONS) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }

    for (const [jsExt, tsExt] of JS_TO_TS) {
      if (specifier.endsWith(jsExt)) {
        try {
          return await nextResolve(specifier.slice(0, -jsExt.length) + tsExt, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }

    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && TS_EXTENSIONS.some((ext) => new URL(url).pathname.endsWith(ext))) {
    const filePath = fileURLToPath(url);
    const source = await readFile(filePath, "utf-8");
    const { code } = transformSync(source, { mode: "transform", filename: filePath });
    return { format: "module", shortCircuit: true, source: `${code}\n//# sourceURL=${url}` };
  }
  return nextLoad(url, context);
}

// Sync hooks for module.registerHooks() (Node >= 22.15.0).
export function resolveSync(specifier, context, nextResolve) {
  try {
    return nextResolve(specifier, context);
  } catch (err) {
    if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw err;

    const lastSegment = specifier.split("/").pop() ?? "";
    if (!lastSegment.includes(".")) {
      for (const ext of TS_EXTENSIONS) {
        try {
          return nextResolve(specifier + ext, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }

    for (const [jsExt, tsExt] of JS_TO_TS) {
      if (specifier.endsWith(jsExt)) {
        try {
          return nextResolve(specifier.slice(0, -jsExt.length) + tsExt, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }

    throw err;
  }
}

export function loadSync(url, context, nextLoad) {
  if (url.startsWith("file:") && TS_EXTENSIONS.some((ext) => new URL(url).pathname.endsWith(ext))) {
    const filePath = fileURLToPath(url);
    const source = readFileSync(filePath, "utf-8");
    const { code } = transformSync(source, { mode: "transform", filename: filePath });
    return { format: "module", shortCircuit: true, source: `${code}\n//# sourceURL=${url}` };
  }
  return nextLoad(url, context);
}
