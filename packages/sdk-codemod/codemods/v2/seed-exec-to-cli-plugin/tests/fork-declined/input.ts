import { fork } from "node:child_process";

export async function seed(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = fork("seed/exec.mjs", [], {
      env: { ...process.env, TAILOR_WORKSPACE_ID: workspaceId },
      stdio: "inherit",
    });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`seed exited with code ${code}`)),
    );
  });
}
