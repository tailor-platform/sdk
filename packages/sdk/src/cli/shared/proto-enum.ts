type ProtoEnumObject<E extends number> = Readonly<Record<string, string | E>>;

/**
 * Get the member name of a generated proto enum value.
 * @param protoEnum - Generated proto enum object
 * @param value - Enum value
 * @returns Member name, or undefined when the enum does not define the value
 */
export function protoEnumName<E extends number>(
  protoEnum: ProtoEnumObject<E>,
  value: number,
): string | undefined {
  const name = protoEnum[value];
  return typeof name === "string" ? name : undefined;
}

/**
 * List the member names of a generated proto enum.
 * @param protoEnum - Generated proto enum object
 * @returns Member names in declaration order
 */
export function protoEnumNames<E extends number>(protoEnum: ProtoEnumObject<E>): string[] {
  return Object.keys(protoEnum).filter((key) => typeof protoEnum[key] === "number");
}

/**
 * Parse a member name of a generated proto enum, ignoring case.
 * @param protoEnum - Generated proto enum object
 * @param input - Member name to parse
 * @param excluded - Members that are not accepted
 * @returns Enum value, or undefined when the name is not an accepted member
 */
export function parseProtoEnumName<E extends number>(
  protoEnum: ProtoEnumObject<E>,
  input: string,
  excluded: readonly E[] = [],
): E | undefined {
  const key = input.toUpperCase();
  if (!Object.hasOwn(protoEnum, key)) return undefined;
  const value = protoEnum[key];
  if (typeof value !== "number" || excluded.includes(value)) return undefined;
  return value;
}

/**
 * Look up the value mapped to a proto enum value in a map that must cover every member, so that
 * a member added to the enum fails to compile until the map is updated.
 * @param map - Mapped value of every enum member
 * @param value - Enum value
 * @param fallback - Result for a value the map does not cover (a newer server than the stubs)
 * @returns Mapped value, or the fallback
 */
export function protoEnumLookup<E extends number, V>(
  map: Readonly<Record<E, V>>,
  value: E,
  fallback: V,
): V {
  return (map as Readonly<Partial<Record<number, V>>>)[value] ?? fallback;
}
