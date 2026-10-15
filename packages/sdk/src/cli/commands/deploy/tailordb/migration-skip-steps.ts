import { CLIError } from "#/cli/shared/errors";
import { assertSkippableSteps } from "./migration-workflow";
import type { MigrationInProgress } from "#/cli/commands/tailordb/migrate/remote-state";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { OperatorClient } from "#/cli/shared/client";

/**
 * Parse the `--migration-skip-steps` value into steps keyed by namespace.
 * @param value - Comma-separated `<namespace>/<step>` entries
 * @returns Steps to skip, keyed by namespace
 */
export function parseMigrationSkipSteps(value: string | undefined): Map<string, string[]> {
  const byNamespace = new Map<string, string[]>();
  if (value === undefined) return byNamespace;
  for (const entry of value.split(",")) {
    const separator = entry.indexOf("/");
    const namespace = entry.slice(0, separator);
    const step = entry.slice(separator + 1);
    if (separator <= 0 || step === "") {
      throw CLIError({
        code: "MIGRATION_SKIP_STEPS_FORMAT_INVALID",
        message: `'${entry}' is not a step to skip.`,
        suggestion:
          "Write each step as <namespace>/<step> and separate entries with commas, e.g. --migration-skip-steps main-db/backfillUser,main-db/backfillInvoice.",
        context: { entry },
      });
    }
    const steps = byNamespace.get(namespace) ?? [];
    if (!steps.includes(step)) steps.push(step);
    byNamespace.set(namespace, steps);
  }
  return byNamespace;
}

/**
 * Write skipped steps back as the `--migration-skip-steps` value.
 * @param steps - Steps to skip, keyed by namespace
 * @returns The option value, or undefined when there is nothing to skip
 */
export function formatMigrationSkipSteps(
  steps: ReadonlyMap<string, readonly string[]> | undefined,
): string | undefined {
  const entries = [...(steps ?? [])].flatMap(([namespace, names]) =>
    names.map((name) => `${namespace}/${name}`),
  );
  return entries.length > 0 ? entries.join(",") : undefined;
}

/**
 * Keep the requested skips that belong to the namespaces of one config.
 * @param requested - Steps to skip, keyed by namespace
 * @param namespaces - TailorDB namespaces of the config
 * @returns The requested skips for those namespaces
 */
export function selectSkipStepsOfNamespaces(
  requested: ReadonlyMap<string, readonly string[]> | undefined,
  namespaces: Iterable<string>,
): Map<string, readonly string[]> {
  const own = new Set(namespaces);
  return new Map([...(requested ?? [])].filter(([namespace]) => own.has(namespace)));
}

export interface MigrationSkipStepsCheck {
  client: OperatorClient;
  workspaceId: string;
  /** Steps to skip, keyed by namespace. */
  requested: ReadonlyMap<string, readonly string[]>;
  pendingMigrations: readonly PendingMigration[];
  /** Migrations an earlier deploy left in progress, by namespace. */
  inProgressByNamespace: Readonly<Record<string, MigrationInProgress>>;
}

/**
 * Reject requested skips that cannot apply, before any migration runs.
 * @param check - The requested skips and the state they are checked against
 */
export async function assertMigrationSkipSteps(check: MigrationSkipStepsCheck): Promise<void> {
  const { client, workspaceId, requested, pendingMigrations, inProgressByNamespace } = check;
  for (const [namespace, steps] of requested) {
    const inProgress = inProgressByNamespace[namespace];
    const migration = pendingMigrations.find(
      (pending) =>
        pending.namespace === namespace &&
        pending.number === inProgress?.number &&
        pending.scriptForm?.kind === "steps",
    );
    if (!inProgress || migration?.scriptForm?.kind !== "steps") {
      throw CLIError({
        code: "MIGRATION_SKIP_STEPS_INVALID",
        message: `Cannot skip steps in namespace '${namespace}': no multi-step migration of it is partially applied by an earlier deploy.`,
        suggestion:
          "Skipping applies only to a multi-step migration that an earlier deploy left partially applied. Remove these entries from --migration-skip-steps.",
        context: { namespace, requested: [...steps] },
      });
    }
    await assertSkippableSteps({
      client,
      workspaceId,
      namespace,
      migrationNumber: migration.number,
      order: migration.scriptForm.order,
      inProgress,
      requested: steps,
    });
  }
}

/**
 * Reject requested skips for a namespace that no deployed config defines.
 * @param requested - Steps to skip, keyed by namespace
 * @param knownNamespaces - TailorDB namespaces of every config in this deploy
 */
export function assertSkipNamespacesKnown(
  requested: ReadonlyMap<string, readonly string[]>,
  knownNamespaces: ReadonlySet<string>,
): void {
  for (const [namespace, steps] of requested) {
    if (knownNamespaces.has(namespace)) continue;
    const namespaces = [...knownNamespaces];
    throw CLIError({
      code: "MIGRATION_SKIP_STEPS_INVALID",
      message: `Cannot skip steps in namespace '${namespace}': no deployed config defines a TailorDB namespace with that name.`,
      suggestion:
        namespaces.length > 0
          ? `Use one of the TailorDB namespaces: ${namespaces.join(", ")}.`
          : "The deployed config defines no TailorDB namespace. Remove --migration-skip-steps.",
      context: { namespace, requested: [...steps], namespaces },
    });
  }
}
