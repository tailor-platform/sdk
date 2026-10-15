import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { isObject } from "./utils";
import type { Problem } from "./types";

export type RubricClaim = { id: string; claim: string };
export type Rubric = { schemaVersion: 1; claims: RubricClaim[] };

const CLAIM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROOT_FIELDS = new Set(["schemaVersion", "claims"]);
const CLAIM_FIELDS = new Set(["id", "claim"]);

export function parseRubric(contents: string): Rubric {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error(
      `rubric.json must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isObject(value)) {
    throw new Error("rubric.json must contain an object");
  }
  rejectUnknownFields(value, ROOT_FIELDS, "rubric.json");
  if (value.schemaVersion !== 1) {
    throw new Error("rubric.json schemaVersion must be 1");
  }
  if (!Array.isArray(value.claims) || value.claims.length === 0) {
    throw new Error("rubric.json must contain at least one claim");
  }
  const seen = new Set<string>();
  const claims = value.claims.map((claim, index) => {
    if (!isObject(claim)) {
      throw new Error(`rubric.json claims[${index}] must be an object`);
    }
    rejectUnknownFields(claim, CLAIM_FIELDS, `rubric.json claims[${index}]`);
    if (typeof claim.id !== "string" || !CLAIM_ID_PATTERN.test(claim.id)) {
      throw new Error(`rubric.json claims[${index}].id must be kebab-case`);
    }
    if (typeof claim.claim !== "string" || claim.claim.trim().length === 0) {
      throw new Error(`rubric.json claims[${index}].claim must be a non-empty string`);
    }
    if (seen.has(claim.id)) {
      throw new Error(`rubric.json has a duplicate claim id: ${claim.id}`);
    }
    seen.add(claim.id);
    return { id: claim.id, claim: claim.claim };
  });
  return { schemaVersion: 1, claims };
}

export async function loadRubric(
  problem: Pick<Problem, "group" | "id" | "rubricPath">,
): Promise<{ rubric: Rubric; hash: string }> {
  if (problem.rubricPath === undefined) {
    throw new Error(`${problem.group}/${problem.id} has no rubric.json`);
  }
  const contents = await fs.readFile(problem.rubricPath, "utf8");
  const rubric = parseRubric(contents);
  return { rubric, hash: createHash("sha256").update(JSON.stringify(rubric)).digest("hex") };
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has an unknown field: ${unknown.join(", ")}`);
  }
}
