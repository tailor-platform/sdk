const regex = {
  date: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
  datetime:
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[Tt](?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d):(?<second>[0-5]\d|60)(\.(?<fraction>\d+))?(?<offset>[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
} as const;

export function isValidDateString(value: string): boolean {
  const match = regex.date.exec(value);
  return match?.groups !== undefined && isValidDateParts(match.groups);
}

export function isValidDateTimeString(value: string): boolean {
  const match = regex.datetime.exec(value);
  return match?.groups !== undefined && isValidDateParts(match.groups);
}

function isValidDateParts(groups: Record<string, string | undefined>): boolean {
  const { year: yearValue, month: monthValue, day: dayValue } = groups;
  if (yearValue === undefined || monthValue === undefined || dayValue === undefined) {
    return false;
  }

  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  return daysInMonth !== undefined && day <= daysInMonth;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
