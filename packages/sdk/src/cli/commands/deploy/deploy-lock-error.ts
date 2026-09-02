/**
 * Another deploy took over this deploy's lock. Nothing queued for the remote
 * may be written any more, including recovery flushes.
 */
export class DeployLockLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployLockLostError";
  }
}
