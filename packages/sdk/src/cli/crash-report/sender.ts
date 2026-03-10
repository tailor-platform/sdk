import type { CrashReport } from "./report";

const SEND_TIMEOUT_MS = 5000;
// Placeholder endpoint; replace with the real URL once the error tracking service is deployed.
const PRODUCTION_ENDPOINT = "https://example.com/crash-report";
const ENDPOINT = process.env.TAILOR_CRASH_REPORT_ENDPOINT || PRODUCTION_ENDPOINT;

/**
 * Send a crash report to the remote endpoint via HTTP POST.
 * Best-effort: never throws, returns boolean success.
 * @param report - Crash report to send
 * @param ua - User-Agent header value
 * @returns true if the request succeeded, false otherwise
 */
export async function sendCrashReport(report: CrashReport, ua: string): Promise<boolean> {
  try {
    const response = await fetch(ENDPOINT, {
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
