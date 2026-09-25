import * as mod from "node:module";
import { pathToFileURL } from "node:url";

const [tsHookPath, entryPath] = process.argv.slice(2);
const { resolveSync, loadSync } = await import(pathToFileURL(tsHookPath).href);
mod.registerHooks({ resolve: resolveSync, load: loadSync });

const entryUrl = pathToFileURL(entryPath);
for (const nonce of ["1", "2"]) {
  entryUrl.searchParams.set("tailorImportNonce", nonce);
  await import(entryUrl.href);
}

console.log(
  JSON.stringify({
    entryEvaluations: globalThis.__tailorNoncePropagationEntryCount,
    childEvaluations: globalThis.__tailorNoncePropagationChildCount,
  }),
);
