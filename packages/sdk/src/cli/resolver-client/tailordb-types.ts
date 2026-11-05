import * as path from "pathe";
import type {
  OperatorFieldConfig,
  ParsedField,
  TailorDBType,
} from "#/parser/service/tailordb/types";
import type { TailorDBNamespaceData } from "#/plugin/types";

/** A TailorDB type of the project and the definition declaring it. */
export interface TailorDBEntry {
  name: string;
  file: string;
  exportName: string;
  type: TailorDBType;
}

/**
 * List the TailorDB types declared in the project's files. Types a plugin
 * generates have no file to take their record type from, so they are left out.
 * @param namespaces - Loaded TailorDB namespaces
 * @returns Each type with its file and export, in config order
 */
export function listTailorDBTypes(namespaces: readonly TailorDBNamespaceData[]): TailorDBEntry[] {
  return namespaces.flatMap(({ tables, sourceInfo }) =>
    Object.entries(tables).flatMap(([name, type]) => {
      const source = sourceInfo.get(name);
      return source?.filePath
        ? [{ name, file: source.filePath, exportName: source.exportName, type }]
        : [];
    }),
  );
}

const PRELUDE = `import type { output } from "@tailor-platform/sdk";

type Wire<T> = T extends { toJSON(): string }
  ? string
  : T extends readonly (infer E)[]
    ? Wire<E>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

type Expand<T> = { [K in keyof T]: T[K] } & {};

type RecordOf<T> = Wire<output<T>>;
type SystemKeys = "id" | "createdAt" | "updatedAt";
type CreateInput<R> = Expand<Omit<R, SystemKeys> & Partial<Pick<R, Extract<SystemKeys, keyof R>>>>;
type UpdateInput<R> = Expand<Partial<Omit<R, "id">>>;
type Equal<V> = { eq?: V; ne?: V };
type Member<V> = Equal<V> & { in?: V[]; nin?: V[] };
type Compare<V> = { gt?: V; gte?: V; lt?: V; lte?: V; between?: { min?: V; max?: V } };
type TextOperators = {
  contains?: string;
  notContains?: string;
  hasPrefix?: string;
  hasSuffix?: string;
  notHasPrefix?: string;
  notHasSuffix?: string;
  regex?: string;
};
type ArrayLength = { eq?: number; ne?: number; gt?: number; gte?: number; lt?: number; lte?: number };
type ElementOf<V> = NonNullable<V> extends readonly (infer E)[] ? E : never;
type ScalarFilter<K, V> = K extends "bool" ? Equal<V>
  : K extends "number" | "ordered" ? Member<V> & Compare<NonNullable<V>>
  : K extends "text" ? Member<V> & TextOperators
  : K extends "uuid" | "enum" ? Member<V>
  : never;
type FieldFilter<K, V> = K extends [infer B]
  ? { len?: ArrayLength; has?: ScalarFilter<B, ElementOf<V>>; all?: ScalarFilter<B, ElementOf<V>>; exists?: boolean }
  : K extends "none" ? never
  : K extends string ? ScalarFilter<K, V>
  : NestedFilter<K, NonNullable<V>>;
type NestedFilter<K, V> = {
  [P in keyof K]?: P extends keyof V ? FieldFilter<K[P], V[P]> : never;
} & { exists?: boolean; and?: NestedFilter<K, V>[]; or?: NestedFilter<K, V>[]; not?: NestedFilter<K, V>[] };
type Filter<R, Kinds> = {
  [P in keyof R]?: P extends keyof Kinds ? FieldFilter<Kinds[P], R[P]> : never;
} & { and?: Filter<R, Kinds>[]; or?: Filter<R, Kinds>[]; not?: Filter<R, Kinds>[] };

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

interface ManyOptions<R, Kinds> {
  query?: Filter<R, Kinds>;
  first?: number;
  after?: string;
  last?: number;
  before?: string;
  order?: { field: Extract<keyof R, string>; direction?: "Asc" | "Desc" }[];
}

type SelectOf<R> = { [K in keyof R]?: true };
type SelectedKeys<S, R> = { [K in keyof S]: S[K] extends true ? K : never }[keyof S] & keyof R;
type Picked<R, S> = [S] extends [undefined] ? R : Expand<Pick<R, SelectedKeys<S, R>>>;

type Relations = Record<string, { record: unknown; kinds: unknown; many: boolean; nullable: boolean }>;
type RelationOptions<Rec, Kinds, Many extends boolean> = { select?: SelectOf<Rec> } & (Many extends true
  ? ManyOptions<Rec, Kinds>
  : {});
type IncludeOf<Rel extends Relations> = {
  [K in keyof Rel]?: true | RelationOptions<Rel[K]["record"], Rel[K]["kinds"], Rel[K]["many"]>;
};
type OptionSelect<O> = O extends { select: infer S } ? S : undefined;
type Related<R, Info extends { many: boolean; nullable: boolean }> = Info["many"] extends true
  ? R[]
  : Info["nullable"] extends true
    ? R | null
    : R;
type Included<Rel extends Relations, I> = {
  [K in keyof I & keyof Rel as I[K] extends false | undefined ? never : K]: Related<
    Picked<Rel[K]["record"], OptionSelect<I[K]>>,
    Rel[K]
  >;
};
type WithIncluded<R, Rel extends Relations, I> = Expand<R & Included<Rel, I>>;

interface TailorDBRecords<R, Kinds, Rel extends Relations = {}> {
  get<const S extends SelectOf<R> | undefined = undefined, const I extends IncludeOf<Rel> = {}>(
    id: string,
    options?: { select?: S; include?: I },
  ): Promise<WithIncluded<Picked<R, S>, Rel, I> | null>;
  list<const S extends SelectOf<R> | undefined = undefined, const I extends IncludeOf<Rel> = {}>(
    args?: ManyOptions<R, Kinds> & { select?: S; include?: I },
  ): Promise<{ nodes: WithIncluded<Picked<R, S>, Rel, I>[]; pageInfo: PageInfo; total: number | null }>;
  create(input: CreateInput<R>): Promise<R>;
  update(id: string, input: UpdateInput<R>): Promise<R>;
  delete(id: string): Promise<boolean>;
}
`;

const KIND_OF_TYPE: Record<string, string> = {
  uuid: "uuid",
  string: "text",
  boolean: "bool",
  integer: "number",
  float: "number",
  decimal: "number",
  enum: "enum",
  date: "ordered",
  datetime: "ordered",
  time: "ordered",
};

function kindOf(config: OperatorFieldConfig): string {
  if (config.type === "nested") {
    return config.array || !config.fields ? '"none"' : kindsOf(config.fields);
  }
  const kind = KIND_OF_TYPE[config.type];
  if (!kind) return '"none"';
  return config.array ? `[${JSON.stringify(kind)}]` : JSON.stringify(kind);
}

function kindsOf(configs: Record<string, OperatorFieldConfig>): string {
  const kinds = Object.entries(configs).map(
    ([name, config]) => `${JSON.stringify(name)}: ${kindOf(config)}`,
  );
  return `{ ${kinds.join("; ")} }`;
}

/**
 * Render how the platform filters each field of a TailorDB type: text,
 * number, ordered (dates and times), bool, uuid or enum, as a one-element tuple for an
 * array and the kinds of the inner fields for a nested object.
 * @param fields - Fields of the type
 * @returns A TypeScript type literal mapping each field name to its kind
 */
export function filterKinds(fields: Record<string, ParsedField>): string {
  return kindsOf(
    Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.config])),
  );
}

function relationsOf(entry: TailorDBEntry, entries: readonly TailorDBEntry[]): string[] {
  const { type } = entry;
  const declared = [
    ...Object.values(type.forwardRelationships).map((relation) => ({
      relation,
      nullable: !type.fields[relation.targetField]?.config.required,
    })),
    ...Object.values(type.backwardRelationships).map((relation) => ({
      relation,
      nullable: !relation.isArray,
    })),
  ];
  return declared.flatMap(({ relation, nullable }) => {
    const target = entries.findIndex((candidate) => candidate.name === relation.targetType);
    return target < 0
      ? []
      : [
          `${relation.name}: { record: RecordOf<typeof definition${target}>; ` +
            `kinds: Kinds${target}; many: ${relation.isArray}; nullable: ${nullable} }`,
        ];
  });
}

/**
 * Render the declarations typing the record operations of each TailorDB type,
 * deriving the record type from the definition that declares the type.
 * @param entries - TailorDB types of the project
 * @returns TypeScript source declaring one object of operations per type
 */
export function renderTailorDBDeclarations(entries: readonly TailorDBEntry[]): string {
  const declarations = entries.map((entry, index) => {
    const { name, file, exportName } = entry;
    const specifier = JSON.stringify(path.join(path.dirname(file), path.parse(file).name));
    const relations = relationsOf(entry, entries);
    const records = `RecordOf<typeof definition${index}>`;
    const generics =
      relations.length > 0
        ? `${records}, Kinds${index}, { ${relations.join("; ")} }`
        : `${records}, Kinds${index}`;
    return [
      `type Kinds${index} = ${filterKinds(entry.type.fields)};`,
      `import type { ${exportName} as definition${index} } from ${specifier};`,
      `declare const crud${index}: TailorDBRecords<${generics}>;`,
      `export { crud${index} as ${JSON.stringify(name)} };`,
    ].join("\n");
  });
  return [PRELUDE, ...declarations, ""].join("\n");
}
