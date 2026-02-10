---
"@tailor-platform/sdk": patch
---

Add automatic chunking for seed data to avoid gRPC message size limits

Large seed data that exceeds the 4MB gRPC message size limit is now automatically split into smaller chunks and sent in multiple requests.
