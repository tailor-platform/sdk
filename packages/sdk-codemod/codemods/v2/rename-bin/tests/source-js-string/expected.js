const script = "tailor deploy";
const spawned = spawn("tailor", ["deploy"]);
const npxSpawned = spawn("npx", ["@tailor-platform/sdk", "login"]);
const npxOptionSpawned = spawn("npx", ["--yes", "@tailor-platform/sdk@latest", "login"]);
const npxProfileSpawned = spawn("npx", ["@tailor-platform/sdk", "--profile", "dev", "login"]);
const pnpmDlxSpawned = spawn("pnpm", ["dlx", "@tailor-platform/sdk", "login"]);
const pnpmBinarySpawned = spawn("pnpm", ["tailor-sdk", "deploy"]);
const pnpmExecSpawned = spawn("pnpm", ["exec", "tailor", "deploy"]);
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
