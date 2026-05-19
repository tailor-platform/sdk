import * as fs from "node:fs";
import * as path from "pathe";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Write a file that may contain secrets with restrictive permissions.
 * Creates the parent directory with 0o700 and the file with 0o600 on POSIX
 * systems so other users on the host cannot read access tokens, refresh
 * tokens, or crash report payloads. On Windows the POSIX mode bits are
 * effectively ignored and ACLs govern access, so the chmod calls are
 * best-effort and silently skipped.
 * @param filePath - Absolute path to write
 * @param content - File content
 */
export function writeSecretFile(filePath: string, content: string | Buffer): void {
  ensureSecretDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, { mode: FILE_MODE });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(filePath, FILE_MODE);
    } catch {
      // Best-effort: ignore filesystems that don't support chmod.
    }
  }
}

/**
 * Ensure a directory exists with 0o700 permissions on POSIX systems.
 * `mkdirSync({ recursive: true })` does not chmod existing directories,
 * so this also tightens permissions on directories that were previously
 * created with looser modes.
 * @param dir - Directory path
 */
export function ensureSecretDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(dir, DIR_MODE);
    } catch {
      // Best-effort: ignore EPERM on directories we don't own.
    }
  }
}

/**
 * Best-effort chmod that only fires when the current mode differs from the
 * target. Silently ignores missing paths and permission errors.
 * @param target - Path to chmod
 * @param mode - Desired POSIX mode bits
 */
function chmodIfDifferent(target: string, mode: number): void {
  try {
    if ((fs.statSync(target).mode & 0o777) !== mode) {
      fs.chmodSync(target, mode);
    }
  } catch {
    // Missing path or permission error — best-effort.
  }
}

/**
 * Tighten an existing file and its parent directory to secret-file modes
 * (0o600 / 0o700) if they are looser. Used by read paths that may not
 * trigger a subsequent write, so that legacy world-readable files are
 * still secured the next time the CLI runs. Silent no-op on Windows and
 * on missing files / permission errors.
 * @param filePath - Absolute path that should be 0o600 and live under a 0o700 directory
 */
export function tightenSecretFilePermissions(filePath: string): void {
  if (process.platform === "win32") return;
  chmodIfDifferent(filePath, FILE_MODE);
  chmodIfDifferent(path.dirname(filePath), DIR_MODE);
}
