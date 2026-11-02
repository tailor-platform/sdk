import { Code, ConnectError } from "@connectrpc/connect";
import { xdgConfig } from "xdg-basedir";
import { requestedJsonModeSource } from "#/cli/shared/args";
import { isCLIError } from "#/cli/shared/errors";
import { CIPromptError, interactiveTerminal, logger } from "#/cli/shared/logger";
import { explicitProfileFromArgs } from "#/cli/shared/plugin";
import { getBannerStatePath, inFailureBackoff, readBannerState, writeBannerState } from "./backoff";
import { lookupSkipReason } from "./decision";
import { formatNotificationBanner, type BannerNotification } from "./format";
/**
 * Post-command notification banner.
 *
 * After an ordinary command, the caller's unread WARNING and CRITICAL platform notifications
 * are listed briefly on stderr. The lookup starts in politty's global `setup` hook and the
 * banner is printed from the global `cleanup` hook once the lookup has answered. A lookup
 * still in flight when the command ends gets up to `END_WAIT_MS` more, then is abandoned, so a
 * command takes at most that much longer, its exit code never changes, and every failure is
 * swallowed. It is interactive-terminal only and never in JSON mode. It is
 * shown after every eligible command until the notifications are read or dismissed (it marks
 * nothing read itself); only a failed lookup pauses it, for `FAILURE_BACKOFF_MS` (backoff.ts).
 *
 * The lookup never renews a stored login (no refresh request, no config write, no lock): a
 * token due for renewal skips the banner, and the client is created with `renewToken: false`.
 */

/**
 * How many notifications one lookup fetches. The banner names the most severe few, so a page
 * larger than that lets an older CRITICAL outrank newer WARNINGs, and lets the banner count the
 * CRITICALs it does not name, without a second request.
 */
const PAGE_SIZE = 20;
/**
 * Environment the lookup depends on. `--env-file` is loaded after `setup`, so a value that
 * changed by `cleanup` means the lookup used another login or platform, or the banner was turned
 * off, and its result is dropped.
 */
const LOOKUP_ENV = [
  "TAILOR_NOTIFICATION_BANNER",
  "TAILOR_PLATFORM_PROFILE",
  "TAILOR_PLATFORM_TOKEN",
  "TAILOR_TOKEN",
  "TAILOR_PLATFORM_URL",
  "PLATFORM_URL",
  "TAILOR_CONFIG_PATH",
] as const;

function lookupEnv(): string {
  return JSON.stringify(LOOKUP_ENV.map((name) => process.env[name] ?? null));
}
/** A lookup unanswered after this long while the command runs is aborted and counted as failed. */
const LOOKUP_TIMEOUT_MS = 3_000;
/**
 * How long the command's end waits for a lookup still in flight. On prod the lookup answers
 * about 160-270 ms after the command starts, so a quick command often ends just before it.
 */
const END_WAIT_MS = 150;

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
  /** The lookup has finished, with a result, a skip, or an error. */
  finished: boolean;
  /** The command ended first; the abort that follows is not a platform failure. */
  abandoned: boolean;
  settled?: LookupResult | undefined;
  stateFile: string | undefined;
  /** {@link lookupEnv} when the lookup started. */
  env: string;
}

let pending: PendingLookup | undefined;

interface StartOptions {
  /** XDG config directory for the backoff state; defaults to the current user's. */
  configDir?: string | undefined;
}

/**
 * Start the unread-notification lookup for this invocation, if it applies. Never throws and
 * does not block the command: the request runs alongside it until {@link printNotificationBanner}.
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
      finished: false,
      abandoned: false,
      stateFile,
      env: lookupEnv(),
    };
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    timeout.unref();
    lookup.promise = runLookup(argv, controller.signal, () => {
      lookup.dispatched = true;
    })
      .then(
        (result) => {
          lookup.finished = true;
          lookup.settled = result;
        },
        () => {
          lookup.finished = true;
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
  // The platform rejected the login, including a renewal that failed inside the client.
  if (error instanceof ConnectError && error.code === Code.Unauthenticated) return true;
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

async function waitAtMost(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([promise, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}

/**
 * Print the banner once the lookup started by {@link startNotificationLookup} has answered,
 * waiting at most `END_WAIT_MS` for one still in flight and abandoning it after that. Never
 * throws, and never waits when the banner would not be printed anyway.
 * @param context - The command's outcome
 * @param context.error - The error the command ended with, if any
 */
export async function printNotificationBanner(context: { error?: unknown }): Promise<void> {
  const lookup = pending;
  pending = undefined;
  if (!lookup) return;
  try {
    const printable =
      lookupEnv() === lookup.env &&
      !suppressedByError(context.error) &&
      !logger.jsonMode &&
      interactiveTerminal();
    if (printable && !lookup.finished) await waitAtMost(lookup.promise, END_WAIT_MS);
    lookup.abandoned = true;
    lookup.controller.abort();
    const result = lookup.settled;
    if (!printable || !result) return;

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
