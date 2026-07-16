const E2E_WORKSPACE_PREFIXES = ["sdk-ci-migration-", "e2e-ws-", "template-e2e-", "sdk-ci-"];

export interface E2EWorkspace {
  id?: string;
  name?: string;
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
    const workspacePrefix = E2E_WORKSPACE_PREFIXES.find((prefix) => name?.startsWith(prefix));
    if (!name || !workspacePrefix) return false;
    if (exactWorkspacePrefix !== undefined) return name.startsWith(exactWorkspacePrefix);
    if (runId !== undefined) {
      const runName = name.slice(workspacePrefix.length);
      return runName === runId || runName.startsWith(`${runId}-`);
    }
    return true;
  });
}
