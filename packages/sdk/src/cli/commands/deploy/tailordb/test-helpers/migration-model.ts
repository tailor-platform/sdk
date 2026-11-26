import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { assert } from "vitest";
import { generateTailorDBTypeManifestFromSnapshot } from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { snapshotTable } from "./migration-apply";
import type {
  SnapshotFieldConfig,
  TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { TailorDBTypeSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

/** A table's string field `f` and enum field `e`, each of which a table may lack. */
export interface ModelShape {
  f: { tag: "Absent" } | { tag: "Present"; value: { required: boolean; unique: boolean } };
  e: { tag: "NoEnum" } | { tag: "Values"; value: ReadonlySet<string> };
}

/** Tables of one namespace, each with its shape. */
type ModelSchema = ReadonlyMap<string, ModelShape>;

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
      })),
    };
    const scenario = describeScenario(trace);
    if (!traces.has(scenario)) traces.set(scenario, trace);
  }
  return [...traces.values()];
}

const QUINT_CLI = fileURLToPath(import.meta.resolve("@informalsystems/quint/dist/src/cli.js"));
const MODEL_SPEC = path.join(import.meta.dirname, "migration-deploy.qnt");

/**
 * Simulate `migration-deploy.qnt` with Quint and read the traces.
 * @param samples - Number of traces to simulate
 * @returns One trace per distinct starting scenario, up to the first `Done` state
 */
export function simulateModelTraces(samples: number): ModelTrace[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-model-"));
  try {
    execFileSync(
      process.execPath,
      [
        QUINT_CLI,
        "run",
        MODEL_SPEC,
        "--step=advance",
        "--max-steps=12",
        `--max-samples=${samples}`,
        `--n-traces=${samples}`,
        "--seed=1",
        "--backend=typescript",
        `--out-itf=${path.join(dir, "t{seq}.itf.json")}`,
      ],
      { stdio: "pipe", timeout: 60_000 },
    );
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
export function describeShape(shape: ModelShape): string {
  return describeFields(
    shape.f.tag === "Present" ? shape.f.value : undefined,
    shape.e.tag === "Values" ? [...shape.e.value] : undefined,
  );
}

interface StringFieldState {
  required?: boolean | undefined;
  unique?: boolean | undefined;
}

function describeFields(f: StringFieldState | undefined, values: string[] | undefined): string {
  const fState = f ? `${f.required ? "req" : "opt"}${f.unique ? "+uniq" : ""}` : "-";
  const eState = values ? values.toSorted().join("") : "-";
  return `f=${fState} e=${eState}`;
}

/**
 * Describe a trace's scenario in one line, for a failure message.
 * @param trace - Model trace
 * @returns The scenario, without the trace's file name
 */
export function describeScenario(trace: ModelTrace): string {
  const schemas = trace.history
    .map((schema, i) => {
      const tables = [...schema]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([name, shape]) => `${name}[${describeShape(shape)}]`)
        .join(",");
      return `${i}${trace.scripted.has(i) ? "*" : ""}:{${tables}}`;
    })
    .join(" ");
  const start = trace.fresh ? "fresh" : `checkpoint ${trace.checkpoint}`;
  return `${start}, maintenance ${trace.maintenance}, ${schemas}`;
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

/**
 * The snapshot table of a model table.
 * @param name - Table name
 * @param shape - Model shape
 * @returns Snapshot table
 */
export function modelTable(name: string, shape: ModelShape): TailorDBSnapshotType {
  return {
    ...snapshotTable(name, modelFields(shape)),
    permissions: { gql: [{ conditions: [], actions: ["read"], permit: "allow" }] },
  };
}

/**
 * The manifest the planner builds for a model table.
 * @param name - Table name
 * @param shape - Model shape
 * @returns Table manifest
 */
export function modelManifest(
  name: string,
  shape: ModelShape,
): MessageInitShape<typeof TailorDBTypeSchema> {
  return generateTailorDBTypeManifestFromSnapshot(modelTable(name, shape), { subscribed: false });
}

interface FakeTable {
  type: MessageInitShape<typeof TailorDBTypeSchema>;
  permission: boolean;
}

/**
 * A namespace on a fake Platform that rejects what the Platform rejects: creating a table or
 * permission that exists fails with `AlreadyExists`, and writing a missing one with `NotFound`.
 * Deleting a table also deletes its permission.
 * @param namespace - The namespace the fake holds
 * @param start - Tables the namespace starts with, each with a GraphQL permission
 * @returns The client overrides, the tables, and every rejected write
 */
export function createFakeNamespace(namespace: string, start: ModelState) {
  const tables = new Map<string, FakeTable>(
    [...start.tables].map(([name, shape]) => [
      name,
      { type: modelManifest(name, shape), permission: true },
    ]),
  );
  const rejections: string[] = [];
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
    listTailorDBTypes: async () => ({
      tailordbTypes: [...tables.values()].map((table) => structuredClone(table.type)),
      nextPageToken: "",
    }),
    createTailorDBType: async (request: Parameters<OperatorClient["createTailorDBType"]>[0]) => {
      const name = tableOf(request.namespaceName, request.tailordbType?.name);
      if (tables.has(name)) reject(Code.AlreadyExists, `table ${name} already exists`);
      tables.set(name, { type: structuredClone(request.tailordbType ?? {}), permission: false });
      return {};
    },
    updateTailorDBType: async (request: Parameters<OperatorClient["updateTailorDBType"]>[0]) => {
      const table = existing(request.namespaceName, request.tailordbType?.name);
      table.type = structuredClone(request.tailordbType ?? {});
      return {};
    },
    deleteTailorDBType: async (request: Parameters<OperatorClient["deleteTailorDBType"]>[0]) => {
      existing(request.namespaceName, request.tailordbTypeName);
      tables.delete(tableOf(request.namespaceName, request.tailordbTypeName));
      return {};
    },
    createTailorDBGQLPermission: async (
      request: Parameters<OperatorClient["createTailorDBGQLPermission"]>[0],
    ) => {
      const table = existing(request.namespaceName, request.typeName);
      if (table.permission) reject(Code.AlreadyExists, `permission of ${request.typeName} exists`);
      table.permission = true;
      return {};
    },
    updateTailorDBGQLPermission: async (
      request: Parameters<OperatorClient["updateTailorDBGQLPermission"]>[0],
    ) => {
      const table = existing(request.namespaceName, request.typeName);
      if (!table.permission) reject(Code.NotFound, `permission of ${request.typeName} not found`);
      return {};
    },
    deleteTailorDBGQLPermission: async (
      request: Parameters<OperatorClient["deleteTailorDBGQLPermission"]>[0],
    ) => {
      const table = existing(request.namespaceName, request.typeName);
      if (!table.permission) reject(Code.NotFound, `permission of ${request.typeName} not found`);
      table.permission = false;
      return {};
    },
  };
  return { overrides, tables, rejections };
}

/** What the fake namespace shows of one table. */
interface ObservedTable {
  shape: string;
  restricted: boolean;
  permission: boolean;
}

function describeManifest(type: MessageInitShape<typeof TailorDBTypeSchema>): string {
  const { f, e } = type.schema?.fields ?? {};
  return describeFields(f, e && (e.allowedValues ?? []).map((value) => value.value ?? ""));
}

function isRestricted(type: MessageInitShape<typeof TailorDBTypeSchema>): boolean {
  const ops = type.schema?.settings?.disableGqlOperations;
  return ops?.create === true && ops.update === true && ops.delete === true;
}

/**
 * Read what the fake namespace shows of each table.
 * @param tables - Tables of the fake namespace
 * @returns Each table's shape, restriction, and permission
 */
export function observeTables(
  tables: ReadonlyMap<string, FakeTable>,
): ReadonlyMap<string, ObservedTable> {
  return new Map(
    [...tables].map(([name, table]) => [
      name,
      {
        shape: describeManifest(table.type),
        restricted: isRestricted(table.type),
        permission: table.permission,
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
    const wantShape = want === undefined ? "absent" : describeShape(want);
    const gotShape = got?.shape ?? "absent";
    const lines: string[] = [];
    if (wantShape !== gotShape) lines.push(`${name}: expected ${wantShape}, got ${gotShape}`);
    if (got && got.restricted !== expected.restricted) {
      lines.push(`${name}: expected ${expected.restricted ? "restricted" : "unrestricted"}`);
    }
    const hasPermission = got?.permission ?? false;
    if (hasPermission !== expected.tables.has(name)) {
      lines.push(`${name}: expected ${hasPermission ? "no permission" : "a permission"}`);
    }
    return lines;
  });
}
