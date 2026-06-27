const script = "tailor-sdk deploy";
const spawned = spawn("tailor-sdk", ["deploy"]);
const argSpawned = spawn("tailor-sdk", ["--arg", "tailor-sdk deploy", "deploy"]);
const npxSpawned = spawn("npx", ["tailor-sdk", "login"]);
const npxOptionSpawned = spawn("npx", ["--yes", "tailor-sdk@latest", "login"]);
const npxProfileSpawned = spawn("npx", ["tailor-sdk", "--profile", "dev", "login"]);
const npxVersionSpawned = spawn("npx", ["tailor-sdk", "--version"]);
const npxPackageFlagSpawned = spawn("npx", ["-p", "tailor-sdk", "tailor-sdk", "login"]);
const npxPackageEqualsSpawned = spawn("npx", ["--package=tailor-sdk", "tailor-sdk", "login"]);
const pnpmDlxSpawned = spawn("pnpm", ["dlx", "tailor-sdk", "login"]);
const pnpmBinarySpawned = spawn("pnpm", ["tailor-sdk", "deploy"]);
const pnpmExecSpawned = spawn("pnpm", ["exec", "tailor-sdk", "deploy"]);
const pnpmExecHelpSpawned = spawn("pnpm", ["exec", "tailor-sdk", "--help"]);
const arrayCommand = ["tailor-sdk", "--profile", "dev", "deploy"];
const npxArgs = ["tailor-sdk", "login"];
spawn("npx", npxArgs);
const docs = (
  <>
    <p>package tailor-sdk is installed</p>
    <code>tailor-sdk deploy</code>
    <code>npx tailor-sdk@latest login</code>
  </>
);
