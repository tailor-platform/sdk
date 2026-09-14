import { z } from "zod";

const agePattern = /^(\d+)(s|m|h|d)$/;

const ageUnitToMs = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

export const ageArg = z.string().regex(agePattern, {
  message: "Invalid duration format. Expected a number with a unit: '30m', '24h', '7d'",
});

/**
 * Parse a validated age string into milliseconds.
 * @param age - Age string such as `30m`, `24h`, or `7d`
 * @returns Age in milliseconds
 */
export function parseAge(age: string): number {
  const match = age.match(agePattern);
  if (!match?.[1] || !match[2]) {
    throw new Error(`invalid age format: ${age}`);
  }
  const unit = match[2] as keyof typeof ageUnitToMs;
  return parseInt(match[1], 10) * ageUnitToMs[unit];
}
