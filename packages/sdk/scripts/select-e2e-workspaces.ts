const E2E_WORKSPACE_PREFIXES = ["sdk-ci-", "sdk-ci-migration-", "e2e-ws-", "template-e2e-"];

export interface E2EWorkspace {
  id?: string;
  name?: string;
}

export function isE2EWorkspaceForRun(name: string, runId: string): boolean {
  return E2E_WORKSPACE_PREFIXES.some(
    (prefix) => name === `${prefix}${runId}` || name.startsWith(`${prefix}${runId}-`),
  );
}

export function selectE2EWorkspaces(
  workspaces: E2EWorkspace[],
  runId?: string,
  exactWorkspacePrefix?: string,
): E2EWorkspace[] {
  if (runId === "") {
    throw new Error("Run ID must not be empty.");
  }
  if (
    exactWorkspacePrefix !== undefined &&
    (!runId || exactWorkspacePrefix !== `e2e-ws-${runId}-`)
  ) {
    throw new Error("Exact workspace prefix must match e2e-ws-<run-id>-.");
  }

  return workspaces.filter((workspace) => {
    const name = workspace.name;
    if (!name || !E2E_WORKSPACE_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
    if (exactWorkspacePrefix !== undefined) return name.startsWith(exactWorkspacePrefix);
    if (runId !== undefined) return isE2EWorkspaceForRun(name, runId);
    return true;
  });
}
