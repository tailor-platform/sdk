const script = "tailor-sdk deploy";
const spawned = spawn("tailor-sdk", ["deploy"]);
const npxSpawned = spawn("npx", ["tailor-sdk", "login"]);
const npxOptionSpawned = spawn("npx", ["--yes", "tailor-sdk@latest", "login"]);
const pnpmDlxSpawned = spawn("pnpm", ["dlx", "tailor-sdk", "login"]);
const pnpmBinarySpawned = spawn("pnpm", ["tailor-sdk", "deploy"]);
const docs = (
  <>
    <p>package tailor-sdk is installed</p>
    <code>tailor-sdk deploy</code>
    <code>npx tailor-sdk@latest login</code>
  </>
);
