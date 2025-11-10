# Create Tailor Platform SDK

`@tailor-platform/create-tailor-sdk` is a CLI tool to quickly scaffold a new [Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/tailor-sdk) project.

## Usage

```bash
npm create @tailor-platform/tailor-sdk [OPTIONS] [NAME]
# OR
yarn create @tailor-platform/tailor-sdk [OPTIONS] [NAME]
# OR
pnpm create @tailor-platform/tailor-sdk [OPTIONS] [NAME]
```

### Arguments

- `NAME`: (Optional) The name of your new project. If not provided, you'll be prompted to enter one.

### Options

- `--template <template-name>`: (Optional) Specify a template to use for your project. If not provided, you'll be prompted to select one from a list of available templates.

## What it does

This tool will:

1. Create a new directory with the specified project name.
2. Scaffold a new Tailor Platform SDK project in that directory using the selected template.
3. Install the necessary dependencies with the package manager being used.
4. Initialize a new Git repository in the project directory.

### Note

- If none of the supported package managers (npm, yarn, pnpm) are found, dependency installation will be skipped.
- If the project already exists within a git repository, git initialization will be skipped.
