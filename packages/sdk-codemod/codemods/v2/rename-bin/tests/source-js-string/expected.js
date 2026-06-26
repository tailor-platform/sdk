const packageName = "tailor-sdk";
const packageList = ["tailor-sdk"];
const resolvedPackage = require.resolve("tailor-sdk/package.json");
const resolvedTemplatePackage = require.resolve(`tailor-sdk/${subpath}`);
const packageTemplate = `tailor-sdk/${version}`;
const packageRegex = /tailor-sdk/;
// package tailor-sdk
// package tailor-sdk is installed
const packageMessage = "package tailor-sdk is installed";
// Install tailor-sdk before running tailor deploy
const mixedPackageAndCommand = "Install tailor-sdk before running tailor deploy";
const dynamicImport = import("tailor-sdk");
const installedPackage = installPackage("tailor-sdk");
const forkedModule = child_process.fork("tailor-sdk/register", ["crash-report"]);
const migrate = "bunx @tailor-platform/sdk@2.0.0-next.2 generate";
const script = ["tailor", "deploy"].join(" ");
const skills = "tailor-sdk-skills";
