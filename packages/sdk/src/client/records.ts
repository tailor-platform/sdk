import { callResolver } from "./call";

/** A relation of a TailorDB type to another type. */
export interface RelationMeta {
  /** GraphQL type name of the records the relation points to. */
  typeName: string;
  /** What to select for each field of those records, in the order the type declares them. */
  fields: Record<string, string>;
  /** Whether those records have a field to sort by. */
  sortable: boolean;
  /** Whether the relation points to many records. */
  many: boolean;
}

/** What the record operations of a TailorDB type are built from. */
export interface RecordTypeMeta {
  /** GraphQL type name, such as `Order`. */
  typeName: string;
  /** Root field that gets one record, such as `order`. */
  one: string;
  /** Root field that lists records, such as `orders`. */
  many: string;
  /** What to select for each field, in the order the type declares them. */
  fields: Record<string, string>;
  /** Whether the type has a field to sort by. */
  sortable: boolean;
  /** The relations of the type, by name. */
  relations: Record<string, RelationMeta>;
}

/** What to take of an included relation: its fields, and the arguments of a one-to-many one. */
export interface RecordIncludeOptions {
  select?: Record<string, unknown>;
  query?: unknown;
  first?: number;
  after?: string;
  last?: number;
  before?: string;
  order?: unknown;
}

type Includes = Record<string, boolean | RecordIncludeOptions | undefined>;
type Select = Record<string, unknown> | undefined;
type Raw = Record<string, unknown>;

const PAGING_ARGUMENTS = ["query", "first", "after", "last", "before", "order"] as const;

function paginationType(relation: RelationMeta, argument: (typeof PAGING_ARGUMENTS)[number]) {
  return {
    query: `${relation.typeName}QueryInput`,
    first: "Int",
    after: "String",
    last: "Int",
    before: "String",
    order: `[${relation.typeName}OrderInput]`,
  }[argument];
}

function selectionOf(type: { typeName: string; fields: Record<string, string> }, select: Select) {
  if (!select) return Object.values(type.fields).join(" ");
  for (const name of Object.keys(select)) {
    if (!(name in type.fields)) throw new Error(`${type.typeName} has no field "${name}"`);
  }
  const picked = Object.entries(type.fields)
    .filter(([name]) => select[name])
    .map(([, fragment]) => fragment);
  if (picked.length === 0) {
    throw new Error(`select must pick at least one field of ${type.typeName}`);
  }
  return picked.join(" ");
}

interface Included {
  fragments: string[];
  declarations: string[];
  variables: Raw;
  many: string[];
}

function included(meta: RecordTypeMeta, includes: Includes | undefined): Included {
  const fragments: string[] = [];
  const declarations: string[] = [];
  const variables: Raw = {};
  const many: string[] = [];

  for (const [name, option] of Object.entries(includes ?? {})) {
    if (!option) continue;
    const relation = meta.relations[name];
    if (!relation) throw new Error(`${meta.typeName} has no relation "${name}"`);

    const options: RecordIncludeOptions = option === true ? {} : option;
    const selection = selectionOf(relation, options.select);
    if (!relation.many) {
      fragments.push(`${name} { ${selection} }`);
      continue;
    }

    const args: string[] = [];
    for (const argument of PAGING_ARGUMENTS) {
      if (options[argument] === undefined) continue;
      if (argument === "order" && !relation.sortable) continue;
      const variable = `${name}_${argument}`;
      declarations.push(`$${variable}: ${paginationType(relation, argument)}`);
      variables[variable] = options[argument];
      args.push(`${argument}: $${variable}`);
    }
    const call = args.length > 0 ? `(${args.join(", ")})` : "";
    fragments.push(`${name}${call} { edges { node { ${selection} } } }`);
    many.push(name);
  }

  return { fragments, declarations, variables, many };
}

function flatten(record: unknown, many: readonly string[]): unknown {
  if (record === null || record === undefined) return record;
  const flattened = { ...(record as Raw) };
  for (const name of many) {
    const connection = flattened[name] as { edges: { node: unknown }[] } | null | undefined;
    if (connection) flattened[name] = connection.edges.map((edge) => edge.node);
  }
  return flattened;
}

/**
 * Create the operations that get, list, create, update and delete the records
 * of a TailorDB type. The code generated for `tailordb.tailor` calls it.
 * @param meta - What the operations are built from
 * @returns The operations of the type
 */
export function createRecords(meta: RecordTypeMeta) {
  const { typeName, one, many } = meta;
  const mutate = (field: string, document: string, variables: Raw) =>
    callResolver({ field, document }, variables);
  const allFields = selectionOf(meta, undefined);

  return {
    async get(id: string, options?: { select?: Select; include?: Includes }): Promise<unknown> {
      const inc = included(meta, options?.include);
      const selection = [selectionOf(meta, options?.select), ...inc.fragments].join(" ");
      const declarations = ["$id: ID!", ...inc.declarations].join(", ");
      const record = await callResolver(
        {
          field: one,
          document: `query ${one}(${declarations}) { ${one}(id: $id) { ${selection} } }`,
        },
        { id, ...inc.variables },
      );
      return flatten(record, inc.many);
    },

    async list(args: Raw & { select?: Select; include?: Includes } = {}) {
      const { select, include: includes, ...paging } = args;
      const inc = included(meta, includes);
      const selection = [selectionOf(meta, select), ...inc.fragments].join(" ");
      const declarations = [
        `$query: ${typeName}QueryInput`,
        "$first: Int",
        "$after: String",
        "$last: Int",
        "$before: String",
        ...(meta.sortable ? [`$order: [${typeName}OrderInput]`] : []),
        ...inc.declarations,
      ];
      const fieldArguments = [
        "query: $query",
        "first: $first",
        "after: $after",
        "last: $last",
        "before: $before",
        ...(meta.sortable ? ["order: $order"] : []),
      ];
      const connection = (await callResolver(
        {
          field: many,
          document:
            `query ${many}(${declarations.join(", ")}) { ${many}(${fieldArguments.join(", ")}) ` +
            `{ edges { node { ${selection} } cursor } ` +
            "pageInfo { hasNextPage hasPreviousPage startCursor endCursor } total } }",
        },
        { ...paging, ...inc.variables },
      )) as { edges: { node: unknown }[]; pageInfo: unknown; total: number | null };
      return {
        nodes: connection.edges.map((edge) => flatten(edge.node, inc.many)),
        pageInfo: connection.pageInfo,
        total: connection.total,
      };
    },

    create: (input: unknown) =>
      mutate(
        `create${typeName}`,
        `mutation create${typeName}($input: ${typeName}CreateInput!) { create${typeName}(input: $input) { ${allFields} } }`,
        { input },
      ),

    update: (id: string, input: unknown) =>
      mutate(
        `update${typeName}`,
        `mutation update${typeName}($id: ID!, $input: ${typeName}UpdateInput!) { update${typeName}(id: $id, input: $input) { ${allFields} } }`,
        { id, input },
      ),

    delete: (id: string) =>
      mutate(
        `delete${typeName}`,
        `mutation delete${typeName}($id: ID!) { delete${typeName}(id: $id) }`,
        { id },
      ),
  };
}
