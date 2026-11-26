import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { assert } from "vitest";
import { stableStringify } from "#/cli/commands/deploy/compare";
import {
  generateTailorDBTypeManifestFromSnapshot,
  protoGqlPermission,
} from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { assertDefined } from "#/utils/assert";
import { snapshotTable } from "./migration-apply";
import type {
  SnapshotFieldConfig,
  SnapshotGqlPermission,
  TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  TailorDBGQLPermissionSchema,
  TailorDBTypeSchema,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";

/** A table's string field `f` and enum field `e`, each of which a table may lack. */
interface ModelShape {
  f: { tag: "Absent" } | { tag: "Present"; value: { required: boolean; unique: boolean } };
  e: { tag: "NoEnum" } | { tag: "Values"; value: ReadonlySet<string> };
}

/** Tables of one namespace, each with its shape. */
type ModelSchema = ReadonlyMap<string, ModelShape>;

/** The values a table's schema exposes: none, or values valid under a shape. */
type ModelRecords = { tag: "Empty" } | { tag: "Holds"; value: ModelShape };

type Maintenance = "DuringMigrations" | "DuringDeploy" | "Off";

type ModelStep =
  | { tag: "Start" }
  | { tag: "Script"; value: number }
  | { tag: "Commit"; value: number }
  | { tag: "Held" }
  | { tag: "Done" };

export interface ModelState {
  step: ModelStep;
  tables: ModelSchema;
  restricted: boolean;
  records: ReadonlyMap<string, ModelRecords>;
}

export interface ModelTrace {
  file: string;
  history: ModelSchema[];
  scripted: ReadonlySet<number>;
  fresh: boolean;
  checkpoint: number;
  maintenance: Maintenance;
  states: ModelState[];
}

function decodeItf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeItf);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (typeof record["#bigint"] === "string") return Number(record["#bigint"]);
  if (Array.isArray(record["#map"])) {
    return new Map(
      (record["#map"] as unknown[][]).map(([key, entry]) => [decodeItf(key), decodeItf(entry)]),
    );
  }
  if (Array.isArray(record["#set"])) return new Set(record["#set"].map(decodeItf));
  if (Array.isArray(record["#tup"])) return record["#tup"].map(decodeItf);
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, decodeItf(entry)]));
}

function readModelTraces(dir: string): ModelTrace[] {
  const traces = new Map<string, ModelTrace>();
  for (const file of fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".itf.json"))
    .toSorted()) {
    const itf = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { states: unknown[] };
    const states = itf.states.map((state) => decodeItf(state) as Record<string, unknown>);
    const first = states[0];
    const doneAt = states.findIndex((state) => (state.step as ModelStep).tag === "Done");
    assert(first && doneAt >= 0, `${file} ends before the deploy is done`);
    const trace: ModelTrace = {
      file,
      history: first.history as ModelSchema[],
      scripted: first.scripted as ReadonlySet<number>,
      fresh: first.fresh as boolean,
      checkpoint: first.checkpoint as number,
      maintenance: (first.maintenance as { tag: Maintenance }).tag,
      states: states.slice(0, doneAt + 1).map((state) => ({
        step: state.step as ModelStep,
        tables: state.tables as ModelSchema,
        restricted: state.restricted as boolean,
        records: state.records as ReadonlyMap<string, ModelRecords>,
      })),
    };
    const scenario = describeScenario(trace);
    if (!traces.has(scenario)) traces.set(scenario, trace);
  }
  return [...traces.values()];
}

const QUINT_CLI = fileURLToPath(import.meta.resolve("@informalsystems/quint/dist/src/cli.js"));
const MODEL_SPEC = path.join(import.meta.dirname, "migration-deploy.qnt");
const QUINT_TIMEOUT_MS = 180_000;

/**
 * Longer than all of `simulateModelTraces`' Quint runs together, each of which stops at
 * `QUINT_TIMEOUT_MS`.
 */
export const SIMULATION_TIMEOUT_MS = 3 * QUINT_TIMEOUT_MS;

function runQuint(args: readonly string[]) {
  return spawnSync(
    process.execPath,
    [QUINT_CLI, "run", MODEL_SPEC, "--step=advance", "--seed=1", "--backend=typescript", ...args],
    { encoding: "utf8", timeout: QUINT_TIMEOUT_MS },
  );
}

function assertQuintPassed(run: ReturnType<typeof runQuint>): void {
  assert(run.status === 0, `quint run failed:\n${run.stdout}${run.stderr}${run.error ?? ""}`);
}

/**
 * Check the invariants of `migration-deploy.qnt` with Quint, simulate it, and read the traces.
 * @param samples - Number of traces to simulate
 * @returns One trace per distinct starting scenario, up to the first `Done` state
 */
export function simulateModelTraces(samples: number): ModelTrace[] {
  assertQuintPassed(
    runQuint(["--max-steps=0", "--max-samples=1", "--invariant=relaxServesScripts"]),
  );
  const sampling = ["--max-steps=12", `--max-samples=${samples}`];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-model-"));
  try {
    const run = runQuint([
      ...sampling,
      `--n-traces=${samples}`,
      `--out-itf=${path.join(dir, "t{seq}.itf.json")}`,
    ]);
    // Asked for many traces, Quint does not name a violated invariant, so a run that exits with a
    // failure runs it again.
    if (run.status !== 0 && run.error === undefined) assertQuintPassed(runQuint(sampling));
    assertQuintPassed(run);
    return readModelTraces(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Describe a shape in a few characters, such as `f=req+uniq e=XY`.
 * @param shape - Model shape
 * @returns The description
 */
function describeShape(shape: ModelShape): string {
  const { f, e } = shape;
  const fState =
    f.tag === "Present"
      ? `${f.value.required ? "req" : "opt"}${f.value.unique ? "+uniq" : ""}`
      : "-";
  const eState = e.tag === "Values" ? [...e.value].toSorted().join("") : "-";
  return `f=${fState} e=${eState}`;
}

function describeRecords(records: ModelRecords | undefined): string {
  if (!records) return "absent";
  return records.tag === "Empty" ? "empty" : `holding ${describeShape(records.value)}`;
}

/**
 * Describe a trace's scenario in one line, for a failure message.
 * @param trace - Model trace
 * @returns The scenario, without the trace's file name
 */
export function describeScenario(trace: ModelTrace): string {
  const schemas = trace.history
    .map((schema, i) => `${i}${trace.scripted.has(i) ? "*" : ""}:{${describeSchema(schema)}}`)
    .join(" ");
  const start = trace.fresh ? "fresh" : `checkpoint ${trace.checkpoint}`;
  return `${start}, maintenance ${trace.maintenance}, ${schemas}`;
}

function describeSchema(schema: ModelSchema): string {
  return [...schema]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, shape]) => `${name}[${describeShape(shape)}]`)
    .join(",");
}

function shapeChanges(before: ModelShape, after: ModelShape): string[] {
  const changes: string[] = [];
  const f = { before: before.f, after: after.f };
  if (f.before.tag === "Absent" && f.after.tag === "Present") changes.push("field added");
  if (f.before.tag === "Present" && f.after.tag === "Absent") changes.push("field removed");
  if (f.before.tag === "Present" && f.after.tag === "Present") {
    const [b, a] = [f.before.value, f.after.value];
    if (!b.required && a.required) changes.push("field made required");
    if (b.required && !a.required) changes.push("field made optional");
    if (!b.unique && a.unique) changes.push("field made unique");
    if (b.unique && !a.unique) changes.push("field made non-unique");
  }
  const e = { before: before.e, after: after.e };
  if (e.before.tag === "NoEnum" && e.after.tag === "Values") changes.push("enum added");
  if (e.before.tag === "Values" && e.after.tag === "NoEnum") changes.push("enum removed");
  if (e.before.tag === "Values" && e.after.tag === "Values") {
    const [b, a] = [e.before.value, e.after.value];
    if (![...b].every((value) => a.has(value))) changes.push("enum values removed");
    if (![...a].every((value) => b.has(value))) changes.push("enum values added");
  }
  return changes;
}

/**
 * Count how often the traces reach each case of a deploy, so a change to what the specification's
 * `init` chooses cannot make a case rare unnoticed.
 * @param traces - Model traces
 * @returns How many traces, pending migrations, or tables reach each case
 */
export function countModelCases(traces: readonly ModelTrace[]): Map<string, number> {
  const counts = new Map<string, number>();
  const count = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const trace of traces) {
    const { history, scripted, checkpoint, fresh } = trace;
    const last = assertDefined(history.at(-1), "every history has a last schema");
    count(`maintenance ${trace.maintenance}, ${fresh ? "fresh workspace" : "checkpoint"}`);
    const removedTables = new Set<string>();
    for (let i = checkpoint + 1; i < history.length; i++) {
      const before = assertDefined(history[i - 1], "every pending migration has a schema before");
      const after = assertDefined(history[i], "every pending migration has a schema after");
      const kind = scripted.has(i) ? "scripted" : "unscripted";
      if (describeSchema(before) === describeSchema(after)) count("data-only migration");
      if (before.size > 0 && after.size === 0) count("migration leaves no tables");
      for (const name of after.keys()) {
        if (before.has(name)) continue;
        count(`${kind} migration adds a table`);
        if (!last.has(name)) count("table only pending migrations define");
      }
      for (const name of before.keys()) {
        if (after.has(name)) continue;
        count(`${kind} migration removes a table`);
        if (last.has(name)) count("table a pending migration removes and a later one adds again");
        removedTables.add(name);
      }
      for (const [name, shape] of after) {
        const previous = before.get(name);
        if (!previous) continue;
        for (const change of shapeChanges(previous, shape)) count(`${kind} migration: ${change}`);
      }
    }
    const atCheckpoint = assertDefined(history[checkpoint], "the checkpoint has a schema");
    if (atCheckpoint.size === 0) {
      count(fresh ? "fresh workspace with an empty baseline" : "checkpoint without tables");
    }
    for (const name of atCheckpoint.keys()) {
      if (!removedTables.has(name)) continue;
      count(`${fresh ? "fresh workspace" : "workspace"} table a pending migration removes`);
    }
  }
  return counts;
}

function modelFields(shape: ModelShape): Record<string, SnapshotFieldConfig> {
  const fields: Record<string, SnapshotFieldConfig> = { name: { type: "string", required: true } };
  if (shape.f.tag === "Present") {
    const { required, unique } = shape.f.value;
    fields.f = { type: "string", required, ...(unique && { unique: true, index: true }) };
  }
  if (shape.e.tag === "Values") {
    fields.e = {
      type: "enum",
      required: false,
      allowedValues: [...shape.e.value].toSorted().map((value) => ({ value })),
    };
  }
  return fields;
}

function modelGqlPermission(name: string): SnapshotGqlPermission {
  return [
    {
      conditions: [],
      actions: name === "A" ? ["read"] : name === "B" ? ["read", "create"] : ["all"],
      permit: "allow",
    },
  ];
}

/**
 * The snapshot table of a model table, whose GraphQL permission depends on its name.
 * @param name - Table name
 * @param shape - Model shape
 * @returns Snapshot table
 */
export function modelTable(name: string, shape: ModelShape): TailorDBSnapshotType {
  return {
    ...snapshotTable(name, modelFields(shape)),
    permissions: { gql: modelGqlPermission(name) },
  };
}

type TableManifest = MessageInitShape<typeof TailorDBTypeSchema>;
type GqlPermission = MessageInitShape<typeof TailorDBGQLPermissionSchema>;

/**
 * The manifest the planner builds for a model table.
 * @param name - Table name
 * @param shape - Model shape
 * @returns Table manifest
 */
function modelManifest(name: string, shape: ModelShape): TableManifest {
  return generateTailorDBTypeManifestFromSnapshot(modelTable(name, shape), { subscribed: false });
}

function modelPermission(name: string): GqlPermission {
  return protoGqlPermission(modelGqlPermission(name));
}

function manifestShape(type: TableManifest): ModelShape {
  const { f, e } = type.schema?.fields ?? {};
  return {
    f: f
      ? { tag: "Present", value: { required: f.required === true, unique: f.unique === true } }
      : { tag: "Absent" },
    e: e
      ? { tag: "Values", value: new Set((e.allowedValues ?? []).map((value) => value.value ?? "")) }
      : { tag: "NoEnum" },
  };
}

// `keepsRecords` and `dropMissing` follow the definitions of the same names in migration-deploy.qnt.
function keepsRecords(s: ModelShape, d: ModelShape): boolean {
  const required = (shape: ModelShape) => shape.f.tag === "Present" && shape.f.value.required;
  const unique = (shape: ModelShape) => shape.f.tag === "Present" && shape.f.value.unique;
  const sValues = s.e.tag === "Values" ? s.e.value : undefined;
  const dValues = d.e.tag === "Values" ? d.e.value : undefined;
  return (
    (!required(s) || required(d)) &&
    (!unique(s) || d.f.tag === "Absent" || unique(d)) &&
    (!sValues || !dValues || [...dValues].every((value) => sValues.has(value)))
  );
}

function dropMissing(records: ModelRecords, shape: ModelShape): ModelRecords {
  if (records.tag === "Empty") return records;
  const { f, e } = records.value;
  return {
    tag: "Holds",
    value: {
      f: shape.f.tag === "Present" ? f : { tag: "Absent" },
      e: shape.e.tag === "Values" ? e : { tag: "NoEnum" },
    },
  };
}

interface FakeTable {
  type: TableManifest;
  permission: GqlPermission | undefined;
  records: ModelRecords;
}

/** A table definition the fake namespace accepted. */
interface FakeWrite {
  kind: "create" | "update";
  table: string;
}

/**
 * A namespace on a fake Platform that rejects what the Platform rejects: creating a table or
 * permission that exists fails with `AlreadyExists`, and writing a missing one with `NotFound`.
 * Deleting a table also deletes its permission. Each table holds the values its schema exposes: a
 * created table has none, a definition without a field hides that field's values, and only
 * `runScript` writes values. A definition those values violate is accepted and listed in
 * `violations`.
 * @param namespace - The namespace the fake holds
 * @param start - Tables the namespace starts with, each with the GraphQL permission it declares and its records
 * @returns The client overrides, the tables, every accepted table definition, every rejected write, every definition the records violate, and `runScript`
 */
export function createFakeNamespace(namespace: string, start: ModelState) {
  const tables = new Map<string, FakeTable>(
    [...start.tables].map(([name, shape]) => [
      name,
      {
        type: modelManifest(name, shape),
        permission: modelPermission(name),
        records: assertDefined(start.records.get(name), `${name} has records`),
      },
    ]),
  );
  const writes: FakeWrite[] = [];
  const rejections: string[] = [];
  const violations: string[] = [];
  const reject = (code: Code, message: string): never => {
    rejections.push(message);
    throw new ConnectError(message, code);
  };
  const tableOf = (namespaceName: string | undefined, name: string | undefined) => {
    if (namespaceName !== namespace || name === undefined) {
      return reject(Code.InvalidArgument, `unexpected table ${namespaceName}/${name}`);
    }
    return name;
  };
  const existing = (namespaceName: string | undefined, name: string | undefined) => {
    const tableName = tableOf(namespaceName, name);
    return tables.get(tableName) ?? reject(Code.NotFound, `table ${tableName} not found`);
  };
  const overrides = {
    listTailorDBServices: async () => ({
      tailordbServices: [{ namespace: { name: namespace } }],
      nextPageToken: "",
    }),
    listTailorDBTypes: async () => ({
      tailordbTypes: [...tables.values()].map((table) => structuredClone(table.type)),
      nextPageToken: "",
    }),
    createTailorDBType: async (request: Parameters<OperatorClient["createTailorDBType"]>[0]) => {
      const name = tableOf(request.namespaceName, request.tailordbType?.name);
      if (tables.has(name)) reject(Code.AlreadyExists, `table ${name} already exists`);
      tables.set(name, {
        type: structuredClone(request.tailordbType ?? {}),
        permission: undefined,
        records: { tag: "Empty" },
      });
      writes.push({ kind: "create", table: name });
      return {};
    },
    updateTailorDBType: async (request: Parameters<OperatorClient["updateTailorDBType"]>[0]) => {
      const name = tableOf(request.namespaceName, request.tailordbType?.name);
      const table = existing(request.namespaceName, name);
      table.type = structuredClone(request.tailordbType ?? {});
      const shape = manifestShape(table.type);
      if (table.records.tag === "Holds" && !keepsRecords(shape, table.records.value)) {
        const records = describeShape(table.records.value);
        violations.push(`wrote ${describeShape(shape)} to ${name}, whose records hold ${records}`);
      }
      table.records = dropMissing(table.records, shape);
      writes.push({ kind: "update", table: name });
      return {};
    },
    deleteTailorDBType: async (request: Parameters<OperatorClient["deleteTailorDBType"]>[0]) => {
      existing(request.namespaceName, request.tailordbTypeName);
      tables.delete(tableOf(request.namespaceName, request.tailordbTypeName));
      return {};
    },
    listTailorDBGQLPermissions: async () => ({
      permissions: [...tables].flatMap(([typeName, table]) =>
        table.permission ? [{ typeName, permission: structuredClone(table.permission) }] : [],
      ),
      nextPageToken: "",
    }),
    createTailorDBGQLPermission: async (
      request: Parameters<OperatorClient["createTailorDBGQLPermission"]>[0],
    ) => {
      const table = existing(request.namespaceName, request.typeName);
      if (table.permission) reject(Code.AlreadyExists, `permission of ${request.typeName} exists`);
      table.permission = structuredClone(request.permission ?? {});
      return {};
    },
    updateTailorDBGQLPermission: async (
      request: Parameters<OperatorClient["updateTailorDBGQLPermission"]>[0],
    ) => {
      const table = existing(request.namespaceName, request.typeName);
      if (!table.permission) reject(Code.NotFound, `permission of ${request.typeName} not found`);
      table.permission = structuredClone(request.permission ?? {});
      return {};
    },
    deleteTailorDBGQLPermission: async (
      request: Parameters<OperatorClient["deleteTailorDBGQLPermission"]>[0],
    ) => {
      const table = existing(request.namespaceName, request.typeName);
      if (!table.permission) reject(Code.NotFound, `permission of ${request.typeName} not found`);
      table.permission = undefined;
      return {};
    },
  };
  const runScript = (schema: ModelSchema) => {
    for (const [name, shape] of schema) {
      const table = tables.get(name);
      if (table) table.records = { tag: "Holds", value: shape };
    }
  };
  return { overrides, tables, writes, rejections, violations, runScript };
}

/** What the fake namespace shows of one table. */
interface ObservedTable {
  shape: ModelShape;
  manifest: TableManifest;
  restricted: boolean;
  permission: GqlPermission | undefined;
  records: ModelRecords;
}

// The model chooses no indexes and treats enum values as a set; restriction is compared on its own.
function comparableManifest(type: TableManifest): TableManifest {
  const manifest = structuredClone(type);
  delete manifest.schema?.settings?.disableGqlOperations;
  for (const field of Object.values(manifest.schema?.fields ?? {})) {
    delete field.index;
    field.allowedValues = field.allowedValues
      ?.map(({ value, description }) => (description ? { value, description } : { value }))
      .toSorted((a, b) => (a.value ?? "").localeCompare(b.value ?? ""));
  }
  return manifest;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonical = (value: unknown) => (value === undefined ? "absent" : stableStringify(value));

function differences(got: unknown, want: unknown, at: string): string[] {
  if (canonical(got) === canonical(want)) return [];
  if (isPlainObject(got) && isPlainObject(want)) {
    return [...new Set([...Object.keys(got), ...Object.keys(want)])]
      .toSorted()
      .flatMap((key) => differences(got[key], want[key], `${at}.${key}`));
  }
  return [`${at}: expected ${canonical(want)}, got ${canonical(got)}`];
}

function isRestricted(type: TableManifest): boolean {
  const ops = type.schema?.settings?.disableGqlOperations;
  return ops?.create === true && ops.update === true && ops.delete === true;
}

/**
 * Read what the fake namespace shows of each table.
 * @param tables - Tables of the fake namespace
 * @returns Each table's shape, definition, restriction, permission, and records
 */
export function observeTables(
  tables: ReadonlyMap<string, FakeTable>,
): ReadonlyMap<string, ObservedTable> {
  return new Map(
    [...tables].map(([name, table]) => [
      name,
      {
        shape: manifestShape(table.type),
        manifest: comparableManifest(table.type),
        restricted: isRestricted(table.type),
        permission: table.permission,
        records: table.records,
      },
    ]),
  );
}

/**
 * Compare what the fake namespace shows with what a model state expects.
 * @param actual - What the fake namespace shows
 * @param expected - Model state
 * @returns One line per mismatch
 */
export function compareTables(
  actual: ReadonlyMap<string, ObservedTable>,
  expected: ModelState,
): string[] {
  return [...new Set([...actual.keys(), ...expected.tables.keys()])].toSorted().flatMap((name) => {
    const want = expected.tables.get(name);
    const got = actual.get(name);
    if (!want || !got) {
      const wantShape = want ? describeShape(want) : "absent";
      return [`${name}: expected ${wantShape}, got ${got ? describeShape(got.shape) : "absent"}`];
    }
    const lines =
      describeShape(want) === describeShape(got.shape)
        ? differences(got.manifest, comparableManifest(modelManifest(name, want)), name)
        : [`${name}: expected ${describeShape(want)}, got ${describeShape(got.shape)}`];
    if (got.restricted !== expected.restricted) {
      lines.push(`${name}: expected ${expected.restricted ? "restricted" : "unrestricted"}`);
    }
    lines.push(...differences(got.permission, modelPermission(name), `${name} permission`));
    const wantRecords = describeRecords(expected.records.get(name));
    if (describeRecords(got.records) !== wantRecords) {
      lines.push(`${name}: expected records ${wantRecords}, got ${describeRecords(got.records)}`);
    }
    return lines;
  });
}
