const packageName = "tailor-sdk";
const packageList = ["tailor-sdk"];
const resolvedPackage = require.resolve("tailor-sdk/package.json");
const resolvedTemplatePackage = require.resolve(`tailor-sdk/${subpath}`);
const packageTemplate = `tailor-sdk/${version}`;
const packageRegex = /tailor-sdk/;
// package tailor-sdk
// package tailor-sdk is installed
const packageMessage = "package tailor-sdk is installed";
const escapedPackageMessage = "package \"tailor-sdk\" is installed";
// Install tailor-sdk before running tailor-sdk deploy
const mixedPackageAndCommand = "Install tailor-sdk before running tailor-sdk deploy";
const dynamicImport = import("tailor-sdk");
const installedPackage = installPackage("tailor-sdk");
const forkedModule = child_process.fork("tailor-sdk/register", ["crash-report"]);
const migrate = "bunx tailor-sdk@2.0.0-next.2 generate";
const escapedQuery = "tailor-sdk query --query \"select 1\"";
const script = ["tailor-sdk", "deploy"].join(" ");
const skills = "tailor-sdk-skills";
const docs = (
  <>
    <p>package tailor-sdk is installed</p>
    <code>tailor-sdk deploy</code>
  </>
);
