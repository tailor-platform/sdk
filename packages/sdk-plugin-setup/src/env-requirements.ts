export type EnvRequirement = {
  name: string;
  type: "secret" | "variable";
  required: boolean;
  /** What the value is. */
  description: string;
  /** Where the value comes from. */
  howTo: string;
  /** Counts only when set on the environment itself, not inherited from the repository or organization. */
  environmentOnly?: boolean;
};

const MACHINE_USER_HOW_TO =
  "have an organization or folder admin create a platform machine user in the Tailor Console " +
  "and grant it a role (without the required permission you cannot view or create machine users)";

export const CLIENT_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID",
  type: "variable",
  required: true,
  description:
    "Client ID of the platform machine user that CI signs in as for plan and deploy; it needs " +
    "an editor or admin role on the organization or folder that holds the workspace",
  howTo: `${MACHINE_USER_HOW_TO}; use its client ID`,
};

export const CLIENT_SECRET: EnvRequirement = {
  name: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET",
  type: "secret",
  required: true,
  description: "Client secret of the same platform machine user",
  howTo: `${MACHINE_USER_HOW_TO}; use its client secret`,
};

export const WORKSPACE_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_WORKSPACE_ID",
  type: "variable",
  required: true,
  description: "ID of the workspace this environment deploys to",
  howTo: "the id printed by `tailor workspace create`, or listed by `tailor workspace list`",
};

export const MIGRATION_TEST_SOURCE_WORKSPACE_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_MIGRATION_TEST_SOURCE_WORKSPACE_ID",
  type: "variable",
  required: true,
  description:
    "ID of the workspace whose migrations and data the migration test starts from; it is only " +
    "read to build the temporary workspace and is not modified",
  howTo: "the id printed by `tailor workspace create`, or listed by `tailor workspace list`",
};

export const ORGANIZATION_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_ORGANIZATION_ID",
  type: "variable",
  required: true,
  description:
    "Organization to create the per-PR preview workspaces in; a machine user cannot create " +
    "a workspace without one",
  howTo: "the organizationId listed by `tailor organization list`",
};

export const FOLDER_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_FOLDER_ID",
  type: "variable",
  required: false,
  description:
    "Folder to create the per-PR preview workspaces in; when unset they are created directly " +
    "under the organization, which needs the machine user's role on the organization itself",
  howTo: "the id listed by `tailor organization folder list -o <organization id>`",
};

export const FAIL_ON_DRIFT: EnvRequirement = {
  name: "TAILOR_PLATFORM_FAIL_ON_DRIFT",
  type: "variable",
  required: false,
  description: "Whether the drift check fails the job when it finds drift",
  howTo: 'set to "true" to fail; anything else only reports the drift',
};

export const SLACK_BOT_TOKEN: EnvRequirement = {
  name: "TAILOR_SLACK_BOT_TOKEN",
  type: "secret",
  required: false,
  description: "Slack bot token that posts deploy notifications (set with TAILOR_SLACK_CHANNEL_ID)",
  howTo: "the Bot User OAuth Token (xoxb-...) of a Slack app with the chat:write scope",
};

export const SLACK_CHANNEL_ID: EnvRequirement = {
  name: "TAILOR_SLACK_CHANNEL_ID",
  type: "variable",
  required: false,
  description: "Slack channel to post deploy notifications to (set with TAILOR_SLACK_BOT_TOKEN)",
  howTo: "the channel ID (C...) shown in the channel details in Slack; invite the bot to it",
};

export const SLACK_USER_MAPPING: EnvRequirement = {
  name: "TAILOR_SLACK_USER_MAPPING",
  type: "variable",
  required: false,
  description:
    "Map from GitHub usernames to Slack user IDs so deploy notifications mention the actor; " +
    "read only after you uncomment the user-mapping input of the tailor-notify step",
  howTo:
    'a JSON object such as {"alice":"U0123456"}, with the member ID (U...) from each Slack profile',
};

export const SEED_USER_PASSWORD: EnvRequirement = {
  name: "SEED_USER_PASSWORD",
  type: "secret",
  required: false,
  description:
    "Password the seed step gives IdP users (`_User`) whose rows have none; a JSON object such as " +
    '{"alice@example.com":"..."} sets it per user. Only read when seeding is enabled',
  howTo: "the password you want the seeded IdP users to sign in with",
};

export const AUTOFIX_APP_CLIENT_ID: EnvRequirement = {
  name: "TAILOR_AUTOFIX_APP_CLIENT_ID",
  type: "variable",
  required: true,
  description:
    "Client ID of the GitHub App that commits the files `tailor generate` changes to pull " +
    "requests; it needs the Contents read and write permission",
  howTo:
    "create a GitHub App with that permission, install it on this repository, and copy the " +
    "Client ID from the App's settings page",
};

export const AUTOFIX_APP_PRIVATE_KEY: EnvRequirement = {
  name: "TAILOR_AUTOFIX_APP_PRIVATE_KEY",
  type: "secret",
  required: true,
  description: "Private key of the same GitHub App",
  howTo:
    "generate a private key on the App's settings page, and pass the downloaded .pem file " +
    "on standard input (`gh secret set ... < key.pem`)",
};

const apiKeyRequirement = (name: string, agent: string, howTo: string): EnvRequirement => ({
  name,
  type: "secret",
  required: true,
  description:
    `API key the ${agent} agent of the autofix workflow uses to finish what the codemods of an ` +
    "SDK upgrade leave for review",
  howTo,
});

export const ANTHROPIC_API_KEY = apiKeyRequirement(
  "TAILOR_AUTOFIX_ANTHROPIC_API_KEY",
  "claude",
  "create an API key in the Claude Console (https://console.anthropic.com/settings/keys)",
);

export const OPENAI_API_KEY = apiKeyRequirement(
  "TAILOR_AUTOFIX_OPENAI_API_KEY",
  "codex",
  "create an API key on the OpenAI platform (https://platform.openai.com/api-keys)",
);

export const COPILOT_TOKEN: EnvRequirement = {
  name: "TAILOR_AUTOFIX_COPILOT_TOKEN",
  type: "secret",
  required: true,
  description:
    "Fine-grained personal access token the copilot agent of the autofix workflow signs in " +
    "with to finish what the codemods of an SDK upgrade leave for review",
  howTo:
    "create a fine-grained personal access token with the Copilot Requests permission " +
    "(https://github.com/settings/personal-access-tokens/new), owned by an account with Copilot",
};

const modelRequirement = (name: string, agent: string, howTo: string): EnvRequirement => ({
  name,
  type: "variable",
  required: false,
  description: `Model the ${agent} agent of the autofix workflow uses; when unset, the agent uses its default model`,
  howTo,
});

export const CLAUDE_MODEL = modelRequirement(
  "TAILOR_AUTOFIX_CLAUDE_MODEL",
  "claude",
  "a model name Claude Code accepts with --model",
);

export const CODEX_MODEL = modelRequirement(
  "TAILOR_AUTOFIX_CODEX_MODEL",
  "codex",
  "a model name Codex accepts with --model",
);

export const COPILOT_MODEL = modelRequirement(
  "TAILOR_AUTOFIX_COPILOT_MODEL",
  "copilot",
  "a model name Copilot CLI accepts with --model",
);

/** Every entry above, in the order generated workflows list them. */
export const ENV_REQUIREMENTS: readonly EnvRequirement[] = [
  CLIENT_ID,
  CLIENT_SECRET,
  WORKSPACE_ID,
  MIGRATION_TEST_SOURCE_WORKSPACE_ID,
  ORGANIZATION_ID,
  FOLDER_ID,
  FAIL_ON_DRIFT,
  SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID,
  SLACK_USER_MAPPING,
  SEED_USER_PASSWORD,
  AUTOFIX_APP_CLIENT_ID,
  AUTOFIX_APP_PRIVATE_KEY,
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  COPILOT_TOKEN,
  CLAUDE_MODEL,
  CODEX_MODEL,
  COPILOT_MODEL,
];
