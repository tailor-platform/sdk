---
"@tailor-platform/sdk": minor
---

`customDomains` entries can now name a destination, moving a domain to another static website — in the same workspace or a different one — without downtime, a new certificate, or a DNS change:

```typescript
defineStaticWebSite("my-website", {
  customDomains: [{ domain: "app.example.com", transferTo: { workspaceId: "..." } }],
});
```

Deploying opens the offer; the receiving side accepts it by listing the domain normally and deploying. `tailor deploy` reports an open offer and says when the domain has moved and the entry can be deleted.

While an offer is open, `tailor deploy` and `tailor remove` refuse to remove the domain or the static website holding it, at plan time and before anything is applied. A plan also fails, rather than quietly doing nothing, when an entry names a domain the site does not hold and no transfer from this workspace accounts for it, or when the domain is still being removed.

`tailor deploy` also now takes ownership of a custom domain that already exists but carries no SDK labels, instead of trying to add it again — the recovery path when a previous deploy lost the response, or when the domain was added through the API or console.
