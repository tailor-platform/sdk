import { readPlatformConfig } from "./context";
import { CLIError } from "./errors";

interface AssertWritableOptions {
  /** Explicit profile name from command args. Falls back to TAILOR_PLATFORM_PROFILE. */
  profile?: string;
}

/**
 * Throw a CLIError if the active profile has `readonly: true`.
 *
 * Resolves the active profile in this order:
 * 1. `opts.profile` (CLI flag)
 * 2. `process.env.TAILOR_PLATFORM_PROFILE`
 *
 * If neither is set, no profile is in scope so the call is allowed. This is
 * intentional: `TAILOR_PLATFORM_TOKEN` direct access (CI / machine user) and
 * `--workspace-id` without a profile are out-of-band paths whose authorization
 * is governed by the bearer token itself, not by the local profile flag.
 *
 * If the resolved profile cannot be found in the config, this function returns
 * silently and lets downstream loaders surface the not-found error.
 * @param opts - Options
 * @param opts.profile - Optional explicit profile name from command args
 */
export async function assertWritable(opts?: AssertWritableOptions): Promise<void> {
  // Truthy fallback (||, not ??) so an empty `--profile ""` flag falls
  // through to TAILOR_PLATFORM_PROFILE, matching loadAccessToken /
  // loadWorkspaceId. Otherwise the loaders would still resolve a readonly
  // profile from the env var while this guard returns silently.
  const profileName = opts?.profile || process.env.TAILOR_PLATFORM_PROFILE;
  if (!profileName) return;
  const config = await readPlatformConfig();
  const profile = config.profiles[profileName];
  if (!profile || profile.readonly !== true) return;
  throw CLIError({
    code: "PROFILE_READONLY",
    message: `Profile "${profileName}" is read-only.`,
    details:
      "This profile blocks platform-state mutations (apply, create/update/delete, deploy, etc.). Application-data operations remain available because their permissions are governed by the machine user.",
    suggestion: `Use a different profile, unset TAILOR_PLATFORM_PROFILE, or run 'tailor profile update ${profileName} --permission write'.`,
  });
}
