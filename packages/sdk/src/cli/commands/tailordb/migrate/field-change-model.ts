import * as c from "@toiroakr/chisel";
import { IN_PLACE_TYPE_CHANGES } from "./field-type-change";
import type { SnapshotFieldConfig } from "./snapshot-types";

const KeyField = c.variants("kind", {
  id: c.object({}),
  named: c.object({ name: c.string() }),
});

const ForeignKeyTarget = c.variants("kind", {
  none: c.object({}),
  to: c.object({ table: c.string(), key: KeyField }),
});

const Scale = c.variants("kind", {
  none: c.object({}),
  set: c.object({ digits: c.int() }),
});

/** What the rules read of a field configuration, with every absence written as a case. */
const RuleField = c.object({
  type: c.string(),
  required: c.boolean(),
  unique: c.boolean(),
  array: c.boolean(),
  serial: c.boolean(),
  vector: c.boolean(),
  foreignKey: c.boolean(),
  foreignKeyTarget: ForeignKeyTarget,
  scale: Scale,
  allowedValues: c.array(c.string()),
});

type RuleField = c.Infer<typeof RuleField>;

const RenamedTarget = c.variants("kind", {
  none: c.object({}),
  to: c.object({ table: c.string() }),
});

const FieldChange = c.variants("kind", {
  added: c.object({ after: RuleField, nestedMember: c.boolean() }),
  modified: c.object({
    before: RuleField,
    after: RuleField,
    nestedMember: c.boolean(),
    /** The table a confirmed rename gives the previous foreign key target. */
    renamedTarget: RenamedTarget,
  }),
});

type FieldChange = c.Infer<typeof FieldChange>;

const Verdict = c.enum(["holds", "unsupported", "none"]);
type Verdict = c.Infer<typeof Verdict>;

/** The rules in the order a field's breaking changes are reported and its statements run. */
export const FIELD_CHANGE_RULE_IDS = [
  "typeChanged",
  "arrayChanged",
  "foreignKeyRetargeted",
  "foreignKeyAdded",
  "requiredFieldAdded",
  "madeRequired",
  "decimalScaleChanged",
  "uniqueAdded",
  "enumValuesRemoved",
] as const;

export type FieldChangeRuleId = (typeof FIELD_CHANGE_RULE_IDS)[number];

/** What the Pre-phase relaxes so `migrate.ts` can run against the rows stored before a change. */
type Relaxation = {
  optional: boolean;
  notUnique: boolean;
  withoutForeignKey: boolean;
  previousEnumValues: boolean;
};

export type FieldChangeOutcome = {
  breaks: Record<FieldChangeRuleId, Verdict>;
  relax: Relaxation;
};

type FieldTerm = c.TermOf<RuleField>;
type ChangeTerm = c.TermOf<FieldChange>;
type Rule = ReturnType<FieldTerm["required"]["$eq"]>;

function any(rules: readonly Rule[]): Rule {
  return rules.reduce((left, right) => left.$or(right));
}

function hasForeignKey(field: FieldTerm): Rule {
  return field.foreignKeyTarget.kind.$eq("to");
}

function keysDiffer(before: FieldTerm, after: FieldTerm): Rule {
  const b = before.foreignKeyTarget.key;
  const a = after.foreignKeyTarget.key;
  return b.kind
    .$ne(a.kind)
    .$or(b.kind.$eq("named").$and(a.kind.$eq("named")).$and(b.name.$ne(a.name)));
}

function changesForeignKeyTarget(before: FieldTerm, after: FieldTerm): Rule {
  return hasForeignKey(before)
    .$and(hasForeignKey(after))
    .$and(
      before.foreignKeyTarget.table
        .$ne(after.foreignKeyTarget.table)
        .$or(keysDiffer(before, after)),
    );
}

function inPlaceTypeChange(before: FieldTerm, after: FieldTerm): Rule {
  const pairs = [...IN_PLACE_TYPE_CHANGES].map((pair) => {
    const [from = "", to = ""] = pair.split(":");
    return before.type.$eq(from).$and(after.type.$eq(to));
  });
  return before.array
    .$eq(false)
    .$and(after.array.$eq(false))
    .$and(before.type.$ne("nested"))
    .$and(after.type.$ne("nested"))
    .$and(before.serial.$eq(false))
    .$and(after.serial.$eq(false))
    .$and(before.vector.$eq(false))
    .$and(after.vector.$eq(false))
    .$and(before.foreignKey.$eq(false))
    .$and(after.foreignKey.$eq(false))
    .$and(any(pairs))
    .$and(before.unique.$eq(false).$or(after.type.$ne("decimal")).$or(before.type.$ne("float")));
}

function verdict(breaks: Rule, unsupported: Rule): c.Expression<Verdict> {
  return c.choose(
    breaks,
    c.choose(unsupported, "unsupported" as const, "holds" as const),
    "none" as const,
  );
}

function holds(breaks: Rule): c.Expression<Verdict> {
  return c.choose(breaks, "holds" as const, "none" as const);
}

const NO_EFFECTS = c.variants("kind", {});

type ConcernRules<Result> = {
  added: (change: c.TermOf<Extract<FieldChange, { kind: "added" }>>) => c.Template<Result>;
  modified: (change: c.TermOf<Extract<FieldChange, { kind: "modified" }>>) => c.Template<Result>;
};

type EnsuresClause = { always: (name: string, rule: unknown) => unknown };

function concern<Result>(
  name: string,
  result: c.Schema<Result>,
  rules: ConcernRules<Result>,
  ensures?: (input: ChangeTerm, answer: c.TermOf<Result>) => Rule,
): c.AnyImplementation {
  const definition = c.behavior(name, {
    input: FieldChange,
    result,
    effects: NO_EFFECTS,
    ...(ensures && {
      ensures: (clause: EnsuresClause) => [clause.always(name, ensures)],
    }),
  } as never) as c.AnyBehavior;
  return c.implement(definition, {
    cases: {
      added: c.model(`${name}: added`, (change) => ({
        result: rules.added(change as never),
        effects: [],
      })),
      modified: c.model(`${name}: modified`, (change) => ({
        result: rules.modified(change as never),
        effects: [],
      })),
    },
  } as never) as c.AnyImplementation;
}

const typeRule = concern("a field changes its type", c.object({ typeChanged: Verdict }), {
  added: () => ({ typeChanged: "none" as const }),
  modified: ({ before, after, nestedMember }) => ({
    typeChanged: verdict(
      before.type.$ne(after.type),
      nestedMember.$eq(true).$or(inPlaceTypeChange(before, after).$not()),
    ),
  }),
});

const arrayRule = concern(
  "a field changes between one value and an array",
  c.object({ arrayChanged: Verdict }),
  {
    added: () => ({ arrayChanged: "none" as const }),
    modified: ({ before, after }) => ({
      arrayChanged: c.choose(
        before.array.$ne(after.array),
        "unsupported" as const,
        "none" as const,
      ),
    }),
  },
);

const foreignKeyRule = concern(
  "the Pre-phase holds a top-level field to no foreign key its stored values may miss",
  c.object({
    foreignKeyRetargeted: Verdict,
    foreignKeyAdded: Verdict,
    withoutForeignKey: c.boolean(),
  }),
  {
    added: () => ({
      foreignKeyRetargeted: "none" as const,
      foreignKeyAdded: "none" as const,
      withoutForeignKey: false,
    }),
    modified: ({ before, after, nestedMember, renamedTarget }) => {
      const added = nestedMember
        .$eq(false)
        .$and(before.foreignKeyTarget.kind.$eq("none"))
        .$and(hasForeignKey(after));
      return {
        foreignKeyRetargeted: verdict(
          changesForeignKeyTarget(before, after).$and(
            keysDiffer(before, after)
              .$or(renamedTarget.kind.$eq("none"))
              .$or(renamedTarget.table.$ne(after.foreignKeyTarget.table)),
          ),
          nestedMember.$eq(true),
        ),
        foreignKeyAdded: holds(added),
        withoutForeignKey: c.choose(changesForeignKeyTarget(before, after).$or(added), true, false),
      };
    },
  },
  (change, answer) =>
    change.kind
      .$eq("added")
      .$or(change.nestedMember.$eq(true))
      .$or(answer.withoutForeignKey.$eq(true))
      .$or(change.after.foreignKeyTarget.kind.$eq("none"))
      .$or(
        change.before.foreignKeyTarget.kind
          .$eq("to")
          .$and(change.before.foreignKeyTarget.table.$eq(change.after.foreignKeyTarget.table))
          .$and(keysDiffer(change.before, change.after).$not()),
      ),
);

const requiredRule = concern(
  "the Pre-phase never requires a value stored rows may lack",
  c.object({ requiredFieldAdded: Verdict, madeRequired: Verdict, optional: c.boolean() }),
  {
    added: ({ after }) => ({
      requiredFieldAdded: holds(after.required.$eq(true)),
      madeRequired: "none" as const,
      optional: c.choose(after.required.$eq(true), true, false),
    }),
    modified: ({ before, after }) => {
      const madeRequired = before.required.$eq(false).$and(after.required.$eq(true));
      return {
        requiredFieldAdded: "none" as const,
        madeRequired: holds(madeRequired),
        optional: c.choose(madeRequired, true, false),
      };
    },
  },
  (change, answer) =>
    change.after.required
      .$eq(false)
      .$or(answer.optional.$eq(true))
      .$or(change.kind.$eq("modified").$and(change.before.required.$eq(true))),
);

const scaleRule = concern(
  "a decimal field changes its scale",
  c.object({ decimalScaleChanged: Verdict }),
  {
    added: () => ({ decimalScaleChanged: "none" as const }),
    modified: ({ before, after, nestedMember }) => ({
      decimalScaleChanged: verdict(
        before.type
          .$eq("decimal")
          .$and(after.type.$eq("decimal"))
          .$and(
            before.scale.kind
              .$ne(after.scale.kind)
              .$or(
                before.scale.kind
                  .$eq("set")
                  .$and(after.scale.kind.$eq("set"))
                  .$and(before.scale.digits.$ne(after.scale.digits)),
              ),
          ),
        nestedMember.$eq(true),
      ),
    }),
  },
);

const uniqueRule = concern(
  "the Pre-phase never demands uniqueness stored rows may break",
  c.object({ uniqueAdded: Verdict, notUnique: c.boolean() }),
  {
    added: () => ({ uniqueAdded: "none" as const, notUnique: false }),
    modified: ({ before, after }) => {
      const added = before.unique.$eq(false).$and(after.unique.$eq(true));
      return { uniqueAdded: holds(added), notUnique: c.choose(added, true, false) };
    },
  },
  (change, answer) =>
    change.after.unique
      .$eq(false)
      .$or(answer.notUnique.$eq(true))
      .$or(change.kind.$eq("added"))
      .$or(change.before.unique.$eq(true)),
);

const enumRule = concern(
  "the Pre-phase accepts every enum value stored rows hold",
  c.object({ enumValuesRemoved: Verdict, previousEnumValues: c.boolean() }),
  {
    added: () => ({ enumValuesRemoved: "none" as const, previousEnumValues: false }),
    modified: ({ before, after }) => {
      const removed = before.type
        .$eq("enum")
        .$and(after.type.$eq("enum"))
        .$and(
          before.allowedValues.$any((value) => after.allowedValues.$all((kept) => kept.$ne(value))),
        );
      return {
        enumValuesRemoved: holds(removed),
        previousEnumValues: c.choose(removed, true, false),
      };
    },
  },
  (change, answer) =>
    change.kind
      .$eq("added")
      .$or(answer.previousEnumValues.$eq(true))
      .$or(change.before.type.$ne("enum"))
      .$or(change.after.type.$ne("enum"))
      .$or(
        change.before.allowedValues.$all((value) =>
          change.after.allowedValues.$any((kept) => kept.$eq(value)),
        ),
      ),
);

/** Each concern of the field change rules, as production code runs it and the tests check it. */
export const FIELD_CHANGE_CONCERNS = [
  typeRule,
  arrayRule,
  foreignKeyRule,
  requiredRule,
  scaleRule,
  uniqueRule,
  enumRule,
] as const;

function ruleField(config: SnapshotFieldConfig): RuleField {
  return {
    type: config.type,
    required: config.required,
    unique: config.unique ?? false,
    array: config.array ?? false,
    serial: config.serial !== undefined,
    vector: config.vector ?? false,
    foreignKey: config.foreignKey ?? false,
    foreignKeyTarget: config.foreignKeyType
      ? {
          kind: "to",
          table: config.foreignKeyType,
          key:
            config.foreignKeyField === undefined
              ? { kind: "id" }
              : { kind: "named", name: config.foreignKeyField },
        }
      : { kind: "none" },
    scale: config.scale === undefined ? { kind: "none" } : { kind: "set", digits: config.scale },
    allowedValues: (config.allowedValues ?? []).map(({ value }) => value),
  };
}

/** A field or nested member a migration changes; `before` is undefined when it adds one. */
export interface FieldChangeInput {
  before: SnapshotFieldConfig | undefined;
  after: SnapshotFieldConfig;
  nestedMember: boolean;
  /** Confirmed table renames (old name → new name); the Pre-phase does not know them, so no relaxation may depend on them. */
  typeRenameTargets: ReadonlyMap<string, string> | undefined;
}

/**
 * Which rules a field change breaks and what the Pre-phase relaxes for it, as `fieldChange` answers.
 * @param input - The changed field
 * @returns The rules' verdicts and the relaxation
 */
export function evaluateFieldChange(input: FieldChangeInput): FieldChangeOutcome {
  const { before, after, nestedMember, typeRenameTargets } = input;
  const change: FieldChange =
    before === undefined
      ? { kind: "added", after: ruleField(after), nestedMember }
      : {
          kind: "modified",
          before: ruleField(before),
          after: ruleField(after),
          nestedMember,
          renamedTarget: renamedTargetOf(before, typeRenameTargets),
        };
  const answers = Object.assign(
    {},
    ...FIELD_CHANGE_CONCERNS.map(
      (concernRules) => c.performSync(concernRules as never, change as never).result as object,
    ),
  ) as Record<FieldChangeRuleId, Verdict> & Relaxation;
  return {
    breaks: Object.fromEntries(FIELD_CHANGE_RULE_IDS.map((id) => [id, answers[id]])) as Record<
      FieldChangeRuleId,
      Verdict
    >,
    relax: {
      optional: answers.optional,
      notUnique: answers.notUnique,
      withoutForeignKey: answers.withoutForeignKey,
      previousEnumValues: answers.previousEnumValues,
    },
  };
}

function renamedTargetOf(
  before: SnapshotFieldConfig,
  typeRenameTargets: ReadonlyMap<string, string> | undefined,
): c.Infer<typeof RenamedTarget> {
  const table = typeRenameTargets?.get(before.foreignKeyType ?? "");
  return table === undefined ? { kind: "none" } : { kind: "to", table };
}
