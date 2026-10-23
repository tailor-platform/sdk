import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "pathe";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Best-effort chmod that only fires when the current mode differs from the
 * target. No-op on Windows (where POSIX mode bits are advisory and ACLs
 * govern access) and on missing paths / permission errors.
 * @param target - Path to chmod
 * @param mode - Desired POSIX mode bits
 */
function chmodIfDifferent(target: string, mode: number): void {
  if (process.platform === "win32") return;
  try {
    if ((fs.statSync(target).mode & 0o777) !== mode) {
      fs.chmodSync(target, mode);
    }
  } catch {
    // Missing path or permission error — best-effort.
  }
}

/**
 * Write a file that may contain secrets with restrictive permissions.
 * Creates the parent directory with 0o700 and the file with 0o600 on POSIX
 * systems so other users on the host cannot read access tokens, refresh
 * tokens, or crash report payloads. On Windows the POSIX mode bits are
 * effectively ignored and ACLs govern access, so the chmod calls are
 * best-effort and silently skipped.
 *
 * The content is written to a temporary file that then replaces the target,
 * so a concurrent reader sees either the old or the new content in full.
 * A symlinked target keeps its link, and the file it points to is replaced.
 * @param filePath - Absolute path to write
 * @param content - File content
 */
export function writeSecretFile(filePath: string, content: string | Buffer): void {
  ensureSecretDir(path.dirname(filePath));
  const target = resolveExistingPath(filePath);
  const tempPath = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, { mode: FILE_MODE, flag: "wx" });
    chmodIfDifferent(tempPath, FILE_MODE);
    renameReplacing(tempPath, target);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function resolveExistingPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return filePath;
    throw error;
  }
}

const WINDOWS_RENAME_RETRY_CODES: ReadonlySet<string> = new Set(["EACCES", "EBUSY", "EPERM"]);
const WINDOWS_RENAME_ATTEMPTS = 10;

function renameReplacing(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        process.platform !== "win32" ||
        attempt >= WINDOWS_RENAME_ATTEMPTS ||
        code === undefined ||
        !WINDOWS_RENAME_RETRY_CODES.has(code)
      ) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 20);
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
  chmodIfDifferent(dir, DIR_MODE);
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
  chmodIfDifferent(filePath, FILE_MODE);
  chmodIfDifferent(path.dirname(filePath), DIR_MODE);
}
