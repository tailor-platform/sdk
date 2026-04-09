# Static Web Site Template

Demonstrates static website configuration with authentication and identity provider integration.

## Features

- Static website definition (`defineStaticWebSite`)
- Identity provider configuration (`defineIdp`) with password policy
- Authentication setup (`defineAuth`) with user profile, machine users, and OAuth2 clients
- CORS configuration using deployment-time `website.url`
- Simple HTML login page with OAuth2 callback handler

## Getting Started

```bash
pnpm install
pnpm deploy
```

After deployment, the static website URL will be available in the deployment output.
Upload the files in `public/` to the static website.
