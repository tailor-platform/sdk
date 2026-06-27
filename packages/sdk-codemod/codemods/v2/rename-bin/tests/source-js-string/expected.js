const script = "tailor deploy";
const spawned = spawn("tailor", ["deploy"]);
const npxSpawned = spawn("npx", ["@tailor-platform/sdk", "login"]);
const npxOptionSpawned = spawn("npx", ["--yes", "@tailor-platform/sdk@latest", "login"]);
const pnpmDlxSpawned = spawn("pnpm", ["dlx", "@tailor-platform/sdk", "login"]);
const pnpmBinarySpawned = spawn("pnpm", ["tailor", "deploy"]);
const docs = (
  <>
    <p>package tailor-sdk is installed</p>
    <code>tailor deploy</code>
    <code>npx @tailor-platform/sdk@latest login</code>
  </>
);
