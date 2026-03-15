/**
 * The fetch-tailor-token composite action YAML.
 */
export const fetchTailorTokenYaml = `name: Fetch Tailor Platform Token
description: Fetch an OAuth2 access token via client credentials grant and export as TAILOR_PLATFORM_TOKEN

inputs:
  client_id:
    description: OAuth2 client ID
    required: true
  client_secret:
    description: OAuth2 client secret
    required: true
  platform_oauth2_url:
    description: OAuth2 token endpoint URL
    required: false
    default: https://api.tailor.tech/oauth2/platform/token

runs:
  using: composite
  steps:
    - name: Fetch access token
      shell: bash
      run: |
        RESPONSE=$(curl -s -X POST "\${{ inputs.platform_oauth2_url }}" \\
          -H "Content-Type: application/x-www-form-urlencoded" \\
          -d "grant_type=client_credentials" \\
          --data-urlencode "client_id=\${{ inputs.client_id }}" \\
          --data-urlencode "client_secret=\${{ inputs.client_secret }}")

        TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')

        if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
          echo "::error::Failed to fetch access token"
          echo "$RESPONSE" | jq .
          exit 1
        fi

        echo "::add-mask::$TOKEN"
        echo "TAILOR_PLATFORM_TOKEN=$TOKEN" >> "$GITHUB_ENV"
`;

/**
 * The install-node composite action YAML.
 */
export const installNodeYaml = `name: Install Node.js
description: Install pnpm, Node.js, and project dependencies

runs:
  using: composite
  steps:
    - name: Install pnpm
      uses: pnpm/action-setup@41ff72655975bd51cab0327fa583b6e92b6d3061 # v4.2.0

    - name: Setup Node.js
      uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0
      with:
        node-version: 22
        cache: pnpm

    - name: Install dependencies
      run: pnpm install --frozen-lockfile
      shell: bash
`;

interface DeployParams {
  workspaceName: string;
  workspaceRegion: string;
  organizationId: string;
  folderId: string;
  workingDirectory?: string;
}

/**
 * Render the deploy workflow YAML.
 * @param params - Workspace and deployment configuration
 * @returns Workflow YAML content
 */
export function renderDeploy(params: DeployParams): string {
  const { workspaceName, workspaceRegion, organizationId, folderId, workingDirectory } = params;

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
        run: pnpm apply -- --yes

      - name: Show application info
        run: pnpm tailor-sdk show -j -w "$TAILOR_PLATFORM_WORKSPACE_ID"
`;
}
