import * as fs from "node:fs";
import * as os from "node:os";

type HeldLockOwner = {
  pid?: number;
  hostname?: string;
  processStartedAt?: number;
  instanceId?: string;
  nonce?: string;
  createdAt?: number;
};

/**
 * Start time of the test process, as the config lock records it for its owner.
 * @returns Epoch milliseconds at which this process started
 */
export function processStartedAt(): number {
  return Math.round(Date.now() - process.uptime() * 1000);
}

/**
 * Write a config lock file as another running tailor process on this host would. By default
 * it names the parent of the test process, which stays alive while the test runs.
 * @param lockPath - Lock file path
 * @param owner - Fields that override the default owner
 */
export function writeHeldConfigLock(lockPath: string, owner: HeldLockOwner = {}): void {
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: process.ppid,
      hostname: os.hostname(),
      processStartedAt: 0,
      instanceId: "other-instance",
      nonce: "other-process",
      createdAt: Date.now(),
      ...owner,
    }),
  );
}
