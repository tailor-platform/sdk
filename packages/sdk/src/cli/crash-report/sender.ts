import type { CrashReport } from "./report";

const SEND_TIMEOUT_MS = 5000;
// Accepted trade-off: placeholder endpoint until the error tracking service is deployed.
// Remote sending defaults to off, so this only affects explicit opt-in via TAILOR_CRASH_REPORTS_REMOTE=on.
const PRODUCTION_ENDPOINT = "https://example.com/crash-report";

/**
 * Send a crash report to the remote endpoint via HTTP POST.
 * Best-effort: never throws, returns boolean success.
 * @param report - Crash report to send
 * @param ua - User-Agent header value
 * @returns true if the request succeeded, false otherwise
 */
export async function sendCrashReport(report: CrashReport, ua: string): Promise<boolean> {
  try {
    const endpoint = process.env.TAILOR_CRASH_REPORT_ENDPOINT || PRODUCTION_ENDPOINT;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": ua,
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    return response.ok;
  } catch {
    return false;
  }
}
