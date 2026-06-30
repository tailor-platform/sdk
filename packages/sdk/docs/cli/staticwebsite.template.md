---
politty:
  index:
    title: "Static Website Commands"
    description: "Commands for managing and deploying static websites."
---

# Static Website Commands

Commands for managing and deploying static websites.

{{politty:command:staticwebsite:heading}}

{{politty:command:staticwebsite:description}}

{{politty:command:staticwebsite:usage}}

{{politty:command:staticwebsite:global-options-link}}

{{politty:command:staticwebsite:subcommands}}

{{politty:command:staticwebsite deploy}}

**Example:**

```bash
# Deploy a static website from the dist directory
tailor-sdk staticwebsite deploy --name my-website --dir ./dist

# Deploy with workspace ID
tailor-sdk staticwebsite deploy -n my-website -d ./dist -w ws_abc123
```

**Notes:**

- The deployment process uploads all files from the specified directory
- Files are uploaded with appropriate MIME types based on file extensions
- Unsupported file types or invalid files will be skipped with warnings
- The deployment URL is returned after successful deployment

{{politty:command:staticwebsite list}}

**Example:**

```bash
# List all static websites
tailor-sdk staticwebsite list

# List with JSON output
tailor-sdk staticwebsite list --json
```

{{politty:command:staticwebsite domain}}
{{politty:command:staticwebsite get}}

**Example:**

```bash
# Get details of a static website
tailor-sdk staticwebsite get my-website

# Get with JSON output
tailor-sdk staticwebsite get my-website --json
```
