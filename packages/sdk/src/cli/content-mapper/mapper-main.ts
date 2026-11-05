import { createLazyHandlers } from "./lazy-handlers";
import { serveJsonRpc } from "./rpc";

// stdout carries the protocol, so anything the project's own code prints goes to stderr.
const writeProtocol = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

async function registerProjectModuleHooks(): Promise<void> {
  const { registerTsHook } = await import("#/cli/shared/register-ts-hook");
  await registerTsHook(new URL("../ts-hook.mjs", import.meta.url));
  (await import("./loaded-files")).observeLoadedFiles();
}

const { EVALUATE_FLAG } = await import("./evaluate-process");
if (process.argv[2] === EVALUATE_FLAG) {
  await registerProjectModuleHooks();
  const { evaluateConfigInProcess } = await import("./mapper");
  writeProtocol(JSON.stringify(await evaluateConfigInProcess(process.argv[3] ?? "")));
} else {
  await serveJsonRpc(
    createLazyHandlers(async () => {
      const { evaluateInFreshProcess } = await import("./evaluate-process");
      return (await import("./mapper")).createContentMapperHandlers(
        evaluateInFreshProcess(process.argv[1] ?? ""),
      );
    }),
    process.stdin,
    (chunk) => writeProtocol(chunk),
  );
}
