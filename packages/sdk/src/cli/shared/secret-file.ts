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
