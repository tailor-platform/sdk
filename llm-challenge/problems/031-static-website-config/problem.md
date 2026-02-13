# 031: Static Website Configuration

## Goal

Create an application configuration that includes a static website with CORS settings.

## Instructions

A `Product` model is already provided in `tailordb/product.ts`.

Create the file `tailor.config.ts` with a **default export** using `defineConfig`.

### Static Website

Define a static website using `defineStaticWebSite`:

- Name: `"my-storefront"`
- Description: `"Storefront application"`

### Config

- name: `"challenge-031"`
- cors: `[website.url]` (use the static website URL reference)
- db: `{ tailordb: { files: ["./tailordb/*.ts"] } }`
- staticWebsites: `[website]`

## Requirements

- Import `defineConfig` and `defineStaticWebSite` from `@tailor-platform/sdk`
- The file must have a **default export** from `defineConfig()`
- Use `website.url` in the `cors` array for type-safe URL references

## Reference

Refer to the installed SDK package for configuration patterns.
