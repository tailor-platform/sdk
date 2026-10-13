/**
 * Dependency graph of a multi-step migration script, shared by the deploy
 * pipeline and the test helper so both run steps in the same order.
 */

/** A migration step as declared in `steps`, reduced to what ordering needs. */
export interface MigrationStepNode {
  name: string;
  dependsOn: readonly string[];
}

const STEP_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Whether a name is valid for a migration step.
 * @param name - Candidate step name
 * @returns True when the name can be used as a step name
 */
export function isMigrationStepName(name: string): boolean {
  return STEP_NAME_PATTERN.test(name);
}

function collectProblems(nodes: readonly MigrationStepNode[]): string[] {
  if (nodes.length === 0) return ["A migration's `steps` must define at least one step."];

  const problems: string[] = [];
  const names = new Set<string>();
  for (const node of nodes) {
    if (!isMigrationStepName(node.name)) {
      problems.push(
        `Step name "${node.name}" is invalid: use a letter followed by up to 63 letters, digits, or underscores.`,
      );
    }
    if (names.has(node.name)) {
      problems.push(`Step "${node.name}" is defined more than once.`);
    }
    names.add(node.name);
  }

  for (const node of nodes) {
    const seen = new Set<string>();
    for (const dependency of node.dependsOn) {
      if (seen.has(dependency)) {
        problems.push(`Step "${node.name}" lists dependency "${dependency}" more than once.`);
      }
      seen.add(dependency);
      if (dependency === node.name) {
        problems.push(`Step "${node.name}" depends on itself.`);
      } else if (!names.has(dependency)) {
        problems.push(`Step "${node.name}" depends on undefined step "${dependency}".`);
      }
    }
  }
  return problems;
}

/**
 * Validate a step graph and return the order its steps run in: every step
 * after the steps it depends on, ties broken by declaration order.
 * @param nodes - Steps in declaration order
 * @returns Step names in execution order
 * @throws {Error} Listing every problem when the graph is invalid
 */
export function orderMigrationSteps(nodes: readonly MigrationStepNode[]): string[] {
  const problems = collectProblems(nodes);
  if (problems.length > 0) throw new Error(problems.join("\n"));

  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < nodes.length) {
    const ready = nodes.find(
      (node) => !done.has(node.name) && node.dependsOn.every((dependency) => done.has(dependency)),
    );
    if (!ready) {
      const cyclic = nodes.filter((node) => !done.has(node.name)).map((node) => node.name);
      throw new Error(
        `Steps ${cyclic.join(", ")} cannot be ordered because their dependencies form a cycle.`,
      );
    }
    order.push(ready.name);
    done.add(ready.name);
  }
  return order;
}
