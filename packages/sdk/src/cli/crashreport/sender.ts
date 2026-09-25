import type { CrashReport } from "./report";

const SEND_TIMEOUT_MS = 5000;
const PRODUCTION_ENDPOINT = "https://sdk-error-tracking-926vh9t4cl.erp.dev/query";

const SUBMIT_MUTATION = `
mutation SubmitCrashReport(
  $id: String!
  $timestamp: String!
  $sdkVersion: String!
  $nodeVersion: String!
  $osPlatform: String!
  $osRelease: String!
  $arch: String!
  $command: String!
  $argv: [String]
  $errorName: String!
  $errorMessage: String!
  $stackTrace: String
  $errorType: String!
  $userId: String
  $userEmail: String
) {
  submitCrashReport(
    id: $id
    timestamp: $timestamp
    sdkVersion: $sdkVersion
    nodeVersion: $nodeVersion
    osPlatform: $osPlatform
    osRelease: $osRelease
    arch: $arch
    command: $command
    argv: $argv
    errorName: $errorName
    errorMessage: $errorMessage
    stackTrace: $stackTrace
    errorType: $errorType
    userId: $userId
    userEmail: $userEmail
  ) {
    success
  }
}`;

/**
 * Send a crash report to the remote endpoint via GraphQL mutation.
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
      body: JSON.stringify({
        query: SUBMIT_MUTATION,
        variables: report,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) return false;

    const data = (await response.json()) as {
      errors?: unknown[];
      data?: { submitCrashReport: { success: boolean } };
    };
    if (data.errors?.length) return false;
    return data.data?.submitCrashReport.success === true;
  } catch {
    return false;
  }
}
