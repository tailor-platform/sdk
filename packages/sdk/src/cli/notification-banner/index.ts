import { xdgConfig } from "xdg-basedir";
import { requestedJsonModeSource } from "#/cli/shared/args";
import { isCLIError } from "#/cli/shared/errors";
import { CIPromptError, interactiveTerminal, logger } from "#/cli/shared/logger";
import { explicitProfileFromArgs } from "#/cli/shared/plugin";
import { lookupSkipReason } from "./decision";
import { formatNotificationBanner, type BannerNotification } from "./format";
import {
  getBannerStatePath,
  inFailureBackoff,
  readBannerState,
  writeBannerState,
} from "./throttle";
/**
 * Post-command notification banner.
 *
 * After an ordinary command, the caller's unread WARNING and CRITICAL platform notifications
 * are listed briefly on stderr. The lookup starts in politty's global `setup` hook and the
 * banner is printed from the global `cleanup` hook only if the lookup has already answered;
 * a pending request is abandoned, so the command's duration and exit code never change, and
 * every failure is swallowed. It is interactive-terminal only and never in JSON mode. It is
 * shown after every eligible command until the notifications are read or dismissed (it marks
 * nothing read itself); only a failed lookup pauses it, for `FAILURE_BACKOFF_MS` (throttle.ts).
 *
 * The lookup never renews a stored login (no refresh request, no config write, no lock): a
 * token due for renewal skips the banner, and the client is created with `renewToken: false`.
 */

/** How many notifications the banner can list. */
const PAGE_SIZE = 3;
/** A lookup unanswered after this long while the command runs is aborted and counted as failed. */
const LOOKUP_TIMEOUT_MS = 3_000;

interface LookupResult {
  /** The profile the command line named, repeated in the hint. */
  explicitProfile: string | undefined;
  totalCount: number;
  notifications: BannerNotification[];
}

interface PendingLookup {
  controller: AbortController;
  promise: Promise<void>;
  /** The request has been sent to the platform; only then can a failure cost load. */
  dispatched: boolean;
  /** The command ended first; the abort that follows is not a platform failure. */
  abandoned: boolean;
  settled?: LookupResult | undefined;
  stateFile: string | undefined;
}

let pending: PendingLookup | undefined;

interface StartOptions {
  /** XDG config directory for the backoff state; defaults to the current user's. */
  configDir?: string | undefined;
}

/**
 * Start the unread-notification lookup for this invocation, if it applies. Never throws and
 * never blocks: the request runs in the background until {@link printNotificationBanner}.
 * @param argv - Command-line arguments after the executable and script path
 * @param options - Test hooks
 */
export function startNotificationLookup(argv: readonly string[], options: StartOptions = {}): void {
  pending = undefined;
  try {
    if (lookupSkipReason(argv, process.env) !== undefined) return;
    if (!interactiveTerminal()) return;
    if (requestedJsonModeSource(argv) !== undefined) return;
    const stateFile = getBannerStatePath("configDir" in options ? options.configDir : xdgConfig);
    if (stateFile && inFailureBackoff(readBannerState(stateFile), Date.now())) return;

    const controller = new AbortController();
    const lookup: PendingLookup = {
      controller,
      promise: Promise.resolve(),
      dispatched: false,
      abandoned: false,
      stateFile,
    };
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    timeout.unref();
    lookup.promise = runLookup(argv, controller.signal, () => {
      lookup.dispatched = true;
    })
      .then(
        (result) => {
          lookup.settled = result;
        },
        () => {
          lookup.settled = undefined;
          // An error or the timeout while the command runs: persist right away, so other
          // terminals back off too. A request the command's end abandons is not a failure: the
          // platform may simply be slower than the command.
          if (lookup.dispatched && !lookup.abandoned) recordFailure(lookup.stateFile);
        },
      )
      .finally(() => clearTimeout(timeout));
    pending = lookup;
  } catch {
    pending = undefined;
  }
}

async function runLookup(
  argv: readonly string[],
  signal: AbortSignal,
  onDispatch: () => void,
): Promise<LookupResult | undefined> {
  // Let the command's own start-up win the first turn of the event loop.
  await new Promise((resolve) => setImmediate(resolve));

  const context = await import("#/cli/shared/context");
  const envToken = context.readEnvironmentToken();
  // readPlatformConfig() creates the config file when it is missing; a background lookup
  // must not do that on a machine that has never logged in.
  if (envToken === undefined && !context.platformConfigExists()) return undefined;

  // Same precedence as the command: last occurrence wins, `--profile x` / `--profile=x` / `-p x` / `-p=x`.
  const explicitProfile = explicitProfileFromArgs(argv);
  const profile = explicitProfile ?? process.env.TAILOR_PLATFORM_PROFILE;
  let accessToken: string;
  let platformConfig: Awaited<ReturnType<typeof context.loadPlatformClientConfig>>;
  if (envToken === undefined) {
    // Never renew a stored login here: this request may be abandoned when the command exits,
    // and a refresh cut short could rotate the refresh token and lose the replacement. A token
    // due for renewal means no banner this time; the command itself renews it.
    const stored = await context.loadStoredAccessTokenWithoutRefresh({ profile });
    if (!stored) return undefined;
    ({ accessToken, platformConfig } = stored);
  } else {
    // Read directly rather than through loadAccessToken, whose deprecated-TAILOR_TOKEN warning
    // the command itself already prints once.
    accessToken = envToken;
    platformConfig = await context.loadPlatformClientConfig({ profile, allowMissingProfile: true });
  }

  const [{ initOperatorClient }, { NotificationSeverity: Severity }] = await Promise.all([
    import("#/cli/shared/client"),
    import("@tailor-platform/tailor-proto/notification_resource_pb"),
  ]);
  const client = await initOperatorClient(accessToken, platformConfig, { renewToken: false });
  onDispatch();
  const response = await client.listMyNotifications(
    { pageSize: PAGE_SIZE, minSeverity: Severity.WARNING, unreadOnly: true },
    { signal },
  );
  return {
    explicitProfile,
    totalCount: Number(response.totalCount),
    notifications: response.notifications.map((n) => ({
      severity: n.severity,
      title: n.title,
    })),
  };
}

function suppressedByError(error: unknown): boolean {
  if (error instanceof CIPromptError) return true;
  return isCLIError(error) && typeof error.code === "string" && error.code.startsWith("AUTH_");
}

/**
 * Remember that a lookup failed, so the next commands back off instead of each sending a
 * request during an outage.
 * @param stateFile - Backoff state path, if the user has a config directory
 */
function recordFailure(stateFile: string | undefined): void {
  if (!stateFile) return;
  try {
    writeBannerState(stateFile, { version: 1, failedAt: new Date(Date.now()).toISOString() });
  } catch {
    // Best effort, like the banner itself.
  }
}

/**
 * Print the banner if the lookup started by {@link startNotificationLookup} has answered, and
 * abandon it otherwise. Never throws, never waits.
 * @param context - The command's outcome
 * @param context.error - The error the command ended with, if any
 */
export async function printNotificationBanner(context: { error?: unknown }): Promise<void> {
  const lookup = pending;
  pending = undefined;
  if (!lookup) return;
  try {
    lookup.abandoned = true;
    lookup.controller.abort();
    const result = lookup.settled;
    if (!result) return;
    if (suppressedByError(context.error)) return;
    if (logger.jsonMode || !interactiveTerminal()) return;

    if (result.notifications.length === 0) return;
    const banner = formatNotificationBanner(result.notifications, result.totalCount, {
      profile: result.explicitProfile,
    });
    logger.newline();
    logger.warn(banner.header);
    for (const line of banner.lines) logger.log(line);
  } catch {
    // Best effort by design: the command's own outcome is what matters.
  }
}

/**
 * Wait for the lookup started by {@link startNotificationLookup} to settle. Tests only.
 * @returns Resolves once the lookup has answered or failed
 */
export async function lookupSettledForTests(): Promise<void> {
  await pending?.promise;
}

/**
 * Forget any lookup in progress. Tests only.
 */
export function resetNotificationLookupForTests(): void {
  pending = undefined;
}
