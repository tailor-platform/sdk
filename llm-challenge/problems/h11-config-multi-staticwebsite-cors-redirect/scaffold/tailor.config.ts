// Author tailor.config.ts so that defineConfig() wires:
//   - two defineStaticWebSite instances: "admin-frontend" and "public-frontend"
//   - cors: [adminSite.url, publicSite.url]
//   - auth: defineAuth("my-auth", { machineUsers: { runner: { ... } },
//       oauth2Clients: { admin: { redirectURIs: [`${adminSite.url}/callback`] },
//       public: { redirectURIs: [`${publicSite.url}/callback`] } } })
//   - staticWebsites: [adminSite, publicSite]
//   - db.tailordb.files: ["./tailordb/*.ts"]
// See problem.md for the full requirements.
