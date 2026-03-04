export const infraFailurePatterns = [
  /Not logged in/i,
  /API key/i,
  /rate limit/i,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /socket hang up/i,
  /authentication.*failed/i,
  /unauthorized/i,
  /403 Forbidden/i,
  /codex login/i,
  // Note: EPERM, EACCES, error_during_execution, and "permission denied" are intentionally
  // excluded because they can match claude-settings.json tool denials (anti-cheat), which
  // are expected model failures, not infrastructure issues.
];

export function detectInfraFailure(output: string): boolean {
  return infraFailurePatterns.some((pattern) => pattern.test(output));
}

export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Only strip Claude Code session/process vars to prevent nested session interference.
  // Preserve other CLAUDE_* vars (e.g. auth, provider config) that users may set.
  for (const key of Object.keys(env)) {
    if (key.startsWith("CLAUDE_CODE_")) {
      delete env[key];
    }
  }
  // Also strip CLAUDECODE to prevent nested-session guard from blocking spawned CLI
  delete env.CLAUDECODE;
  delete env.OLDPWD;

  // Strip variables that may leak workspace or challenge root paths.
  // PWD and INIT_CWD are always removed because they can expose the
  // parent process's directory (e.g. the repository root), which helps
  // the model locate benchmark artifacts. The child process already
  // receives the correct cwd via spawn's `cwd` option.
  delete env.npm_config_local_prefix;
  delete env.npm_package_json;
  delete env.TURBO_HASH;
  delete env.PWD;
  delete env.INIT_CWD;

  // Strip node_modules/.bin entries from PATH. When the runner is invoked
  // via pnpm, PATH includes entries like ".../llm-challenge/node_modules/.bin"
  // which leak the absolute repo/challenge root path. The child process
  // (Codex/Claude) does not need the parent's node_modules binaries — it has
  // its own workspace with separately installed dependencies.
  //
  // On Windows, the actual key in the spread object may be "Path" (not "PATH")
  // because process.env is a case-insensitive proxy but the spread produces a
  // plain object. We find the key case-insensitively to handle both.
  // Path entries may use backslash separators on Windows.
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path");
  if (pathKey && env[pathKey]) {
    const sep = process.platform === "win32" ? ";" : ":";
    env[pathKey] = env[pathKey]
      .split(sep)
      .filter(
        (entry) => !entry.includes("node_modules/.bin") && !entry.includes("node_modules\\.bin"),
      )
      .join(sep);
  }

  return env;
}
