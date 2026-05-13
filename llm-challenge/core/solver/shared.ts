export const infraFailurePatterns = [
  /Not logged in/i,
  /API key/i,
  /rate limit/i,
  /hit your (?:\w+ )?limit/i,
  /usage limit (?:reached|exceeded)/i,
  /quota (?:exceeded|exhausted)/i,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /socket hang up/i,
  /authentication.*failed/i,
  /unauthorized/i,
  /403 Forbidden/i,
  /codex login/i,
];

export function detectInfraFailure(output: string): boolean {
  return infraFailurePatterns.some((pattern) => pattern.test(output));
}
