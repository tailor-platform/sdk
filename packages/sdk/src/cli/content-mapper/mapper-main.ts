// The process TypeScript starts as the `.tailor` content mapper (`typescript.contentMapper` in package.json).
import { createLazyHandlers } from "./lazy-handlers";
import { serveJsonRpc } from "./rpc";

// stdout carries the protocol, so anything the project's own code prints goes to stderr.
const writeProtocol = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

await serveJsonRpc(
  createLazyHandlers(async () => {
    const { registerTsHook } = await import("#/cli/shared/register-ts-hook");
    await registerTsHook(new URL("../ts-hook.mjs", import.meta.url));
    (await import("./loaded-files")).observeLoadedFiles();
    return (await import("./mapper")).createContentMapperHandlers();
  }),
  process.stdin,
  (chunk) => writeProtocol(chunk),
);
