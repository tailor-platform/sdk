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

type FieldTerm = c.TermOf<RuleField>;
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

const FieldChangeOutcome = c.object({
  breaks: c.object(
    Object.fromEntries(FIELD_CHANGE_RULE_IDS.map((id) => [id, Verdict])) as Record<
      FieldChangeRuleId,
      typeof Verdict
    >,
  ),
  relax: c.object({
    optional: c.boolean(),
    notUnique: c.boolean(),
    withoutForeignKey: c.boolean(),
    previousEnumValues: c.boolean(),
  }),
});

const none = "none" as const;

/**
 * Field changes that rows stored under the previous schema can break, and what the Pre-phase
 * relaxes so `migrate.ts` can run against those rows. Its `ensures` hold on every answer.
 */
export const fieldChange = c.behavior("field change", {
  input: FieldChange,
  result: FieldChangeOutcome,
  effects: c.variants("kind", {}),
  ensures: (clause) => [
    clause.always("the Pre-phase never requires a value stored rows may lack", (change, outcome) =>
      change.after.required
        .$eq(false)
        .$or(outcome.relax.optional.$eq(true))
        .$or(change.kind.$eq("modified").$and(change.before.required.$eq(true))),
    ),
    clause.always(
      "the Pre-phase never demands uniqueness stored rows may break",
      (change, outcome) =>
        change.after.unique
          .$eq(false)
          .$or(outcome.relax.notUnique.$eq(true))
          .$or(change.kind.$eq("added"))
          .$or(change.before.unique.$eq(true)),
    ),
    clause.always("the Pre-phase accepts every enum value stored rows hold", (change, outcome) =>
      change.kind
        .$eq("added")
        .$or(outcome.relax.previousEnumValues.$eq(true))
        .$or(change.before.type.$ne("enum"))
        .$or(change.after.type.$ne("enum"))
        .$or(
          change.before.allowedValues.$all((value) =>
            change.after.allowedValues.$any((kept) => kept.$eq(value)),
          ),
        ),
    ),
    clause.always(
      "the Pre-phase holds a top-level field to no foreign key its stored values may miss",
      (change, outcome) =>
        change.kind
          .$eq("added")
          .$or(change.nestedMember.$eq(true))
          .$or(outcome.relax.withoutForeignKey.$eq(true))
          .$or(change.after.foreignKeyTarget.kind.$eq("none"))
          .$or(
            change.before.foreignKeyTarget.kind
              .$eq("to")
              .$and(change.before.foreignKeyTarget.table.$eq(change.after.foreignKeyTarget.table))
              .$and(keysDiffer(change.before, change.after).$not()),
          ),
    ),
  ],
});

/** The rules production code judges every field change by. */
export const fieldChangeRules = c.implement(fieldChange, {
  cases: {
    added: c.model("added field", ({ after }) => ({
      result: {
        breaks: {
          typeChanged: none,
          arrayChanged: none,
          foreignKeyRetargeted: none,
          foreignKeyAdded: none,
          requiredFieldAdded: holds(after.required.$eq(true)),
          madeRequired: none,
          decimalScaleChanged: none,
          uniqueAdded: none,
          enumValuesRemoved: none,
        },
        relax: {
          optional: c.choose(after.required.$eq(true), true, false),
          notUnique: false,
          withoutForeignKey: false,
          previousEnumValues: false,
        },
      },
      effects: [],
    })),
    modified: c.model("modified field", ({ before, after, nestedMember, renamedTarget }) => {
      const foreignKeyAdded = nestedMember
        .$eq(false)
        .$and(before.foreignKeyTarget.kind.$eq("none"))
        .$and(hasForeignKey(after));
      const madeRequired = before.required.$eq(false).$and(after.required.$eq(true));
      const uniqueAdded = before.unique.$eq(false).$and(after.unique.$eq(true));
      const enumValuesRemoved = before.type
        .$eq("enum")
        .$and(after.type.$eq("enum"))
        .$and(
          before.allowedValues.$any((value) => after.allowedValues.$all((kept) => kept.$ne(value))),
        );
      return {
        result: {
          breaks: {
            typeChanged: verdict(
              before.type.$ne(after.type),
              nestedMember.$eq(true).$or(inPlaceTypeChange(before, after).$not()),
            ),
            arrayChanged: c.choose(before.array.$ne(after.array), "unsupported" as const, none),
            foreignKeyRetargeted: verdict(
              changesForeignKeyTarget(before, after).$and(
                keysDiffer(before, after)
                  .$or(renamedTarget.kind.$eq("none"))
                  .$or(renamedTarget.table.$ne(after.foreignKeyTarget.table)),
              ),
              nestedMember.$eq(true),
            ),
            foreignKeyAdded: holds(foreignKeyAdded),
            requiredFieldAdded: none,
            madeRequired: holds(madeRequired),
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
            uniqueAdded: holds(uniqueAdded),
            enumValuesRemoved: holds(enumValuesRemoved),
          },
          relax: {
            optional: c.choose(madeRequired, true, false),
            notUnique: c.choose(uniqueAdded, true, false),
            withoutForeignKey: c.choose(
              changesForeignKeyTarget(before, after).$or(foreignKeyAdded),
              true,
              false,
            ),
            previousEnumValues: c.choose(enumValuesRemoved, true, false),
          },
        },
        effects: [],
      };
    }),
  },
});

export type FieldChangeOutcome = c.Infer<typeof FieldChangeOutcome>;

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
  return c.performSync(fieldChangeRules, change).result;
}

function renamedTargetOf(
  before: SnapshotFieldConfig,
  typeRenameTargets: ReadonlyMap<string, string> | undefined,
): c.Infer<typeof RenamedTarget> {
  const table = typeRenameTargets?.get(before.foreignKeyType ?? "");
  return table === undefined ? { kind: "none" } : { kind: "to", table };
}
