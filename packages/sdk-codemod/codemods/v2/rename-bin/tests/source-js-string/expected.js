const script = "tailor deploy";
const spawned = spawn("tailor", ["deploy"]);
const argSpawned = spawn("tailor", ["--arg", "tailor-sdk deploy", "deploy"]);
const npxSpawned = spawn("npx", ["@tailor-platform/sdk", "login"]);
const npxOptionSpawned = spawn("npx", ["--yes", "@tailor-platform/sdk@latest", "login"]);
const npxProfileSpawned = spawn("npx", ["@tailor-platform/sdk", "--profile", "dev", "login"]);
const npxShortProfileSpawned = spawn("npx", ["@tailor-platform/sdk", "-p", "dev", "login"]);
const npxVersionSpawned = spawn("npx", ["@tailor-platform/sdk", "--version"]);
const npxDynamicSpawned = spawn("npx", ["@tailor-platform/sdk", subcommand]);
const npxPackageFlagSpawned = spawn("npx", ["-p", "@tailor-platform/sdk", "tailor", "login"]);
const npxPackageEqualsSpawned = spawn("npx", ["--package=@tailor-platform/sdk", "tailor", "login"]);
const npxPackageFlagDynamicSpawned = spawn("npx", ["-p", "@tailor-platform/sdk", "tailor", subcommand]);
const npxPackageEqualsDynamicSpawned = spawn("npx", ["--package=@tailor-platform/sdk", "tailor", subcommand]);
const pnpmDlxSpawned = spawn("pnpm", ["dlx", "@tailor-platform/sdk", "login"]);
const pnpmDlxDynamicSpawned = spawn("pnpm", ["dlx", "@tailor-platform/sdk"]);
const pnpmBinarySpawned = spawn("pnpm", ["tailor-sdk", "deploy"]);
const pnpmExecSpawned = spawn("pnpm", ["exec", "tailor", "deploy"]);
const pnpmExecHelpSpawned = spawn("pnpm", ["exec", "tailor", "--help"]);
const arrayCommand = ["tailor-sdk", "--profile", "dev", "deploy"];
const npxArgs = ["tailor-sdk", "login"];
spawn("npx", npxArgs);
const docs = (
  <>
    <p>package tailor-sdk is installed</p>
    <code>tailor deploy</code>
    <code>npx @tailor-platform/sdk@latest login</code>
  </>
);
