import url from "node:url";
import path from "node:path";
import { Tailor, Workspace } from "@tailor-platform/tailor-sdk";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function defineWorkspace(distPath?: string) {
  Tailor.init(distPath ?? path.join(__dirname, "..", ".tailor-sdk"));

  const workspace = new Workspace("tailor-sdk-dev");
  const app = workspace.newApplication("my-app");
  app.defineTailorDB({
    "my-db": { files: ["./src/tailordb/*.ts"] },
  });
  app.defineResolver({
    "my-pipeline": { files: ["./src/resolvers/**/resolver.ts"] },
  });
  app.defineAuth({
    namespace: "my-auth",
    idProviderConfigs: [
      {
        IdTokenConfig: {
          Kind: "IDToken",
          ClientID: "exampleco",
          ProviderURL: "https://exampleco-enterprises.auth0.com/",
        },
        Name: "sample",
        Config: {
          Kind: "IDToken",
          ClientID: "exampleco",
          ProviderURL: "https://exampleco-enterprises.auth0.com/",
        },
      },
    ],
    userProfileProvider: "TAILORDB",
    userProfileProviderConfig: {
      Kind: "TAILORDB",
      Namespace: "my-db",
      Type: "User",
      UsernameField: "email",
      AttributesFields: ["roles"],
    },
    scimConfig: null,
    tenantProvider: "",
    tenantProviderConfig: null,
    machineUsers: [
      {
        Name: "admin-machine-user",
        Attributes: ["4293a799-4398-55e6-a19a-fe8427d1a415"],
      },
    ],
    oauth2Clients: [],
  });

  return workspace;
}

if (process.argv[1] === __filename) {
  const workspace = await defineWorkspace(process.argv[2]);
  await workspace.apply().catch(console.error);
}
