const regex = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  datetime:
    /^\d{4}-\d{2}-\d{2}[Tt](?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d):(?<second>[0-5]\d|60)(\.(?<fraction>\d+))?(?<offset>[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
} as const;

export function isValidDateString(value: string): boolean {
  return regex.date.test(value);
}

export function isValidDateTimeString(value: string): boolean {
  return regex.datetime.test(value);
}
