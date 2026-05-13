// Author tailor.config.ts so that defineConfig() wires:
//   - a single defineStaticWebSite("my-frontend", ...) instance
//   - cors[0] === site.url
//   - auth.oauth2Clients.web.redirectURIs[0] === `${site.url}/callback`
//   - auth: defineAuth("my-auth", { machineUsers: { runner: { ... } } })
//   - staticWebsites: [site]
//   - db.tailordb.files: ["./tailordb/*.ts"]
// See problem.md for the full requirements.
