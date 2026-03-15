type DeployParams = {
  workspaceName: string;
  workspaceRegion: string;
  organizationId: string;
  folderId: string;
  workingDirectory?: string;
};

/**
 * Render the deploy workflow YAML.
 *
 * Targets single-application scaffolds (those with `generate` and `deploy` scripts).
 * Multi-application projects (e.g. chained `deploy:*` scripts) need manual workflow customization.
 * @param params - Workspace and deployment configuration
 * @returns Workflow YAML content
 */
export function renderDeploy(params: DeployParams): string {
  const { workspaceName, workspaceRegion, organizationId, folderId, workingDirectory } = params;

  // --dir sets working-directory for all run steps. Assumes the target directory
  // is a pnpm workspace member with its own package.json (standard monorepo layout).
  const defaultsBlock = workingDirectory
    ? `\ndefaults:\n  run:\n    working-directory: ${workingDirectory}\n`
    : "";

  return `name: Deploy

on:
  push:
    branches:
      - main
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: false

env:
  WORKSPACE_NAME: ${workspaceName}
  WORKSPACE_REGION: ${workspaceRegion}
  TAILOR_PLATFORM_ORGANIZATION_ID: ${organizationId}
  TAILOR_PLATFORM_FOLDER_ID: ${folderId}
${defaultsBlock}
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false

      - name: Install Node.js
        uses: ./.github/actions/install-node

      - name: Fetch Tailor Platform token
        uses: ./.github/actions/fetch-tailor-token
        with:
          client_id: \${{ secrets.PLATFORM_MACHINE_USER_CLIENT_ID }}
          client_secret: \${{ secrets.PLATFORM_MACHINE_USER_CLIENT_SECRET }}

      - name: Ensure workspace exists
        run: |
          WORKSPACE_ID=$(pnpm tailor-sdk workspace list -j | jq -r --arg name "$WORKSPACE_NAME" --arg region "$WORKSPACE_REGION" '.[] | select(.name == $name and .region == $region) | .id')

          if [ -z "$WORKSPACE_ID" ]; then
            echo "Workspace '$WORKSPACE_NAME' not found, creating..."
            WORKSPACE_ID=$(pnpm tailor-sdk workspace create -j --name "$WORKSPACE_NAME" --region "$WORKSPACE_REGION" --organization-id "$TAILOR_PLATFORM_ORGANIZATION_ID" --folder-id "$TAILOR_PLATFORM_FOLDER_ID" | jq -r '.id')
            echo "Created workspace: $WORKSPACE_ID"
          else
            echo "Found existing workspace: $WORKSPACE_ID"
          fi

          echo "TAILOR_PLATFORM_WORKSPACE_ID=$WORKSPACE_ID" >> "$GITHUB_ENV"

      - name: Generate types
        run: pnpm generate

      - name: Deploy
        # Runs the "deploy" script from package.json (tailor-sdk apply --yes)
        run: pnpm run deploy -- --yes

      - name: Show application info
        run: pnpm tailor-sdk show -j -w "$TAILOR_PLATFORM_WORKSPACE_ID"
`;
}
