import { parentPort, workerData } from "node:worker_threads";
import { runFunctionWatch } from "@tailor-platform/sdk/cli";
import type { WatchWorkerCommand, WatchWorkerInput, WatchWorkerMessage } from "./watch-worker";

const port = parentPort;
if (port === null) throw new Error("This module runs as a worker thread.");
const post = (message: WatchWorkerMessage) => port.postMessage(message);

try {
  const watch = await runFunctionWatch({ ...(workerData as WatchWorkerInput), onEvent: post });
  port.on("message", (command: WatchWorkerCommand) => {
    if (command.type === "stop") void watch.close().then(() => process.exit(0));
  });
} catch (error) {
  post({ type: "start-failed", message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
