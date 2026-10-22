---
"@tailor-platform/sdk": minor
---

`customDomains` entries can now name a destination, moving a domain to another static website — in the same workspace or a different one — without downtime, a new certificate, or a DNS change:

```typescript
defineStaticWebSite("my-website", {
  customDomains: [{ domain: "app.example.com", transferTo: { workspaceId: "..." } }],
});
```

Deploying opens the offer; the receiving side accepts it by listing the domain normally and deploying. `tailor deploy` reports an open offer, says when the domain has moved and the entry can be deleted, and refuses to remove a domain whose offer is still open.

`tailor deploy` also now takes ownership of a custom domain that already exists but carries no SDK labels, instead of trying to add it again — the recovery path when a previous deploy lost the response, or when the domain was added through the API or console.
