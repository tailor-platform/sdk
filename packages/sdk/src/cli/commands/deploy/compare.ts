import {
  clone,
  create,
  toBinary,
  toJson,
  type DescMessage,
  type MessageInitShape,
  type MessageShape,
} from "@bufbuild/protobuf";

/**
 * Canonicalize a proto message (or init shape) into proto JSON for comparison.
 *
 * Deserialized messages materialize implicit proto3 fields with their zero
 * values while locally built init shapes omit them, so comparing the raw
 * objects reports a diff for every field the SDK does not set — including
 * fields newly added to the proto. Proto JSON omits implicit zero values on
 * both sides, which matches wire semantics (unset == zero value).
 * @param schema - Message schema describing the value
 * @param value - Message or init shape to canonicalize
 * @param normalize - Rewrites Platform-filled defaults and order-insensitive lists in place, on a copy
 * @returns Proto JSON representation of the value
 */
export function toComparableProtoJson<Desc extends DescMessage>(
  schema: Desc,
  value: MessageInitShape<Desc>,
  normalize?: (message: MessageShape<Desc>) => void,
): unknown {
  const message = clone(schema, create(schema, value));
  normalize?.(message);
  return toJson(schema, message);
}

type MemberName<Desc extends DescMessage> = Exclude<
  keyof MessageShape<Desc>,
  "$typeName" | "$unknown"
>;

/**
 * The members of a request that deploy compares with the existing resource:
 * every member of `schema` except `excluded`.
 */
export interface RequestComparison<
  Desc extends DescMessage,
  Excluded extends MemberName<Desc> = never,
> {
  /** Request schema whose members, minus `excluded`, are compared. */
  schema: Desc;
  /** Members that identify the resource or that the SDK leaves to the Platform. */
  excluded: readonly Excluded[];
  /** Rewrites Platform-filled defaults and order-insensitive lists in place, on both sides. */
  normalize?: ((request: MessageShape<Desc>) => void) | undefined;
}

type ComparedMember<Desc extends DescMessage, Excluded extends MemberName<Desc>> = Exclude<
  MemberName<Desc>,
  Excluded
>;

/**
 * An existing resource (or a wrapper holding it under the request's member
 * name) that carries every compared request member with the request's type.
 */
export type ComparableExisting<
  Desc extends DescMessage,
  Excluded extends MemberName<Desc>,
  Existing,
> = Existing &
  ([Exclude<ComparedMember<Desc, Excluded>, keyof Existing>] extends [never] ? unknown : never);

/**
 * Declare which request members deploy compares, inferring `excluded` as literal member names.
 * @param comparison - Request schema, excluded members, and normalizer
 * @returns The same comparison
 */
export function defineRequestComparison<
  Desc extends DescMessage,
  const Excluded extends MemberName<Desc> = never,
>(comparison: RequestComparison<Desc, Excluded>): RequestComparison<Desc, Excluded> {
  return comparison;
}

/**
 * Whether the existing resource already holds every compared member of the
 * request deploy would send.
 * @param comparison - Compared request members and their normalizer
 * @param sent - Request deploy sends, with plan-time placeholders resolved
 * @param existing - Existing resource, or a wrapper holding it under the request's member name
 * @returns True when no compared member differs
 */
export function isRequestUnchanged<
  Desc extends DescMessage,
  Excluded extends MemberName<Desc>,
  Existing extends Pick<MessageShape<Desc>, ComparedMember<Desc, Excluded>>,
>(
  comparison: RequestComparison<Desc, Excluded>,
  sent: MessageInitShape<Desc>,
  existing: ComparableExisting<Desc, Excluded, Existing>,
): boolean {
  const { schema, excluded, normalize } = comparison;
  const excludedNames = new Set<PropertyKey>(excluded);
  const compared = schema.members
    .map((member) => member.localName)
    .filter((name) => !excludedNames.has(name));
  const pick = (value: object) =>
    Object.fromEntries(
      compared.map((name) => [name, (value as Record<string, unknown>)[name]]),
    ) as MessageInitShape<Desc>;
  return areNormalizedEqual(
    toComparableProtoJson(schema, pick(sent), normalize),
    toComparableProtoJson(schema, pick(existing), normalize),
  );
}

/**
 * The policy list of each action of a permission message, whose members are all policy lists.
 * @param schema - Permission message schema
 * @param permission - Permission message
 * @returns The message's own lists, so sorting one reorders the message
 */
export function actionPolicyLists<Desc extends DescMessage>(
  schema: Desc,
  permission: MessageShape<Desc> | undefined,
): Array<MessageShape<Desc>[MemberName<Desc>]> {
  if (!permission) return [];
  return schema.members.map((action) => permission[action.localName as MemberName<Desc>]);
}

type UnsetEmptyMessageParams<Desc extends DescMessage, Key extends string> = {
  schema: Desc;
  owner: { [K in Key]?: MessageShape<Desc> };
  key: Key;
};

/**
 * Treat a submessage with no field set as unset, for a Platform that returns
 * an empty submessage where the SDK sends none.
 * @param params - Submessage schema, the message holding it, and the field name
 * @param params.schema - Submessage schema
 * @param params.owner - Message holding the submessage
 * @param params.key - Field name of the submessage in the owner
 */
export function unsetEmptyMessage<Desc extends DescMessage, Key extends string>(
  params: UnsetEmptyMessageParams<Desc, Key>,
): void {
  const { schema, owner, key } = params;
  const message = owner[key];
  if (!message || toBinary(schema, message).length === 0) delete owner[key];
}

/**
 * Stable JSON-like serialization that sorts object keys and ignores proto runtime metadata.
 * @param value - Value to serialize
 * @returns Stable serialized string
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, entryValue]) => key !== "$typeName" && entryValue !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  if (typeof value === "bigint") {
    return JSON.stringify(value.toString());
  }
  return JSON.stringify(value);
}

/**
 * Normalize a proto-ish object into a plain JSON-compatible structure for comparison.
 * @param value - Value to normalize
 * @returns Normalized value
 */
export function normalizeProtoConfig<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(stableStringify(value)) as T;
}

/**
 * Compare two values after proto normalization.
 * @param left - Left value
 * @param right - Right value
 * @returns True when normalized values are equal
 */
export function areNormalizedEqual(left: unknown, right: unknown): boolean {
  return (
    stableStringify(normalizeProtoConfig(left)) === stableStringify(normalizeProtoConfig(right))
  );
}
