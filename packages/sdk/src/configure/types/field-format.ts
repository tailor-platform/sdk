const regex = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  datetime:
    /^\d{4}-\d{2}-\d{2}[Tt](?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d):(?<second>[0-5]\d|60)(\.(?<fraction>\d+))?(?<offset>[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
  time: /^(?<hour>\d{2}):(?<minute>\d{2})$/,
  decimal: /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/,
} as const;

export function isValidUUIDString(value: string): boolean {
  return regex.uuid.test(value);
}

export function isValidDateString(value: string): boolean {
  return regex.date.test(value);
}

export function isValidDateTimeString(value: string): boolean {
  return regex.datetime.test(value);
}

export function isValidTimeString(value: string): boolean {
  return regex.time.test(value);
}

export function isValidDecimalString(value: string): boolean {
  return regex.decimal.test(value);
}
