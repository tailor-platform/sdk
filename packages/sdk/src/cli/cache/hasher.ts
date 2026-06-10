import * as crypto from "node:crypto";
import * as fs from "node:fs";

/**
 * Compute the SHA-256 hex digest of an arbitrary string.
 * @param content - The string content to hash
 * @returns Hex-encoded SHA-256 hash
 */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Read a file and return its SHA-256 hex digest.
 * @param filePath - Absolute path to the file
 * @returns Hex-encoded SHA-256 hash of the file content
 */
function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Compute a deterministic SHA-256 hash for multiple files.
 *
 * Paths are sorted alphabetically before hashing so that the result
 * is independent of the order the paths are supplied (e.g. glob ordering).
 * Each file's individual hash is concatenated and then hashed again.
 * @param filePaths - Array of absolute file paths
 * @returns Hex-encoded SHA-256 hash representing all files
 */
function hashFiles(filePaths: string[]): string {
  const sorted = filePaths.toSorted();
  const combined = sorted.map((fp) => hashFile(fp)).join("");
  return hashContent(combined);
}

export { hashContent, hashFile, hashFiles };
