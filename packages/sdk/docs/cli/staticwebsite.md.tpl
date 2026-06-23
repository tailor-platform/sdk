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

{{politty:command:staticwebsite:subcommands}}

{{politty:command:staticwebsite:global-options-link}}
{{politty:command:staticwebsite deploy:heading}}

{{politty:command:staticwebsite deploy:description}}

{{politty:command:staticwebsite deploy:usage}}

{{politty:command:staticwebsite deploy:options}}

{{politty:command:staticwebsite deploy:global-options-link}}
{{politty:command:staticwebsite list:heading}}

{{politty:command:staticwebsite list:description}}

{{politty:command:staticwebsite list:usage}}

{{politty:command:staticwebsite list:options}}

{{politty:command:staticwebsite list:global-options-link}}
{{politty:command:staticwebsite domain:heading}}

{{politty:command:staticwebsite domain:description}}

{{politty:command:staticwebsite domain:usage}}

{{politty:command:staticwebsite domain:global-options-link}}

{{politty:command:staticwebsite domain:subcommands}}
{{politty:command:staticwebsite domain get:heading}}

{{politty:command:staticwebsite domain get:description}}

{{politty:command:staticwebsite domain get:usage}}

{{politty:command:staticwebsite domain get:arguments}}

{{politty:command:staticwebsite domain get:options}}

{{politty:command:staticwebsite domain get:global-options-link}}

{{politty:command:staticwebsite domain list:heading}}

{{politty:command:staticwebsite domain list:description}}

{{politty:command:staticwebsite domain list:usage}}

{{politty:command:staticwebsite domain list:arguments}}

{{politty:command:staticwebsite domain list:options}}

{{politty:command:staticwebsite domain list:global-options-link}}

{{politty:command:staticwebsite get:heading}}

{{politty:command:staticwebsite get:description}}

{{politty:command:staticwebsite get:usage}}

{{politty:command:staticwebsite get:arguments}}

{{politty:command:staticwebsite get:options}}

{{politty:command:staticwebsite get:global-options-link}}

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

**Example:**

```bash
# List all static websites
tailor-sdk staticwebsite list

# List with JSON output
tailor-sdk staticwebsite list --json
```

**Example:**

```bash
# Get details of a static website
tailor-sdk staticwebsite get my-website

# Get with JSON output
tailor-sdk staticwebsite get my-website --json
```
