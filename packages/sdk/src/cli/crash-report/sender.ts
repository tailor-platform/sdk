import type { CrashReport } from "./report";

const SEND_TIMEOUT_MS = 5000;
// Crash reports use api.tailor.wiki (separate from the main api.tailor.tech platform API).
// This webhook endpoint may not be deployed yet; sendCrashReport returns false on failure.
const PRODUCTION_ENDPOINT = "https://api.tailor.wiki/hook/crash-report";

/**
 * Send a crash report to the remote endpoint via HTTP POST.
 * Best-effort: never throws, returns boolean success.
 * @param report - Crash report to send
 * @param ua - User-Agent header value
 * @returns true if the request succeeded, false otherwise
 */
export async function sendCrashReport(report: CrashReport, ua: string): Promise<boolean> {
  try {
    const response = await fetch(PRODUCTION_ENDPOINT, {
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
