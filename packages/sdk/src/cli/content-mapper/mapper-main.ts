import * as fs from "node:fs";
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
  const { loadedFiles } = await import("./loaded-files");
  let reported = false;
  process.on("exit", (code) => {
    if (reported) return;
    reported = true;
    try {
      fs.writeSync(
        1,
        JSON.stringify({
          error: `The config process exited with code ${code} before it finished`,
          files: loadedFiles(),
        }),
      );
    } catch {
      // The process that started this one may already be gone.
    }
  });
  process.on("SIGTERM", () => process.exit(1));
  process.stdin.on("end", () => process.exit(1)).resume();
  await registerProjectModuleHooks();
  const { evaluateConfigInProcess } = await import("./mapper");
  const evaluation = JSON.stringify(await evaluateConfigInProcess(process.argv[3] ?? ""));
  reported = true;
  writeProtocol(evaluation, () => process.exit(0));
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
