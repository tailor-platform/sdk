export type DateString = `${number}-${number}-${number}`;
export type TimeString = `${number}:${number}`;
export type TimeZoneOffsetString = "Z" | "z" | `${"+" | "-"}${TimeString}`;
export type DateTimeString =
  `${DateString}${"T" | "t"}${TimeString}:${number}${"" | `.${number}`}${TimeZoneOffsetString}`;
export type UUIDString = `${string}-${string}-${string}-${string}-${string}`;
export type DecimalString = `${number}`;
