tailor --json function test-run a.ts
tailor -e .env function test-run a.ts
tailor function --verbose test-run a.ts
tailor --env-file ".env local" --no-json function test-run a.ts
tailor -je .env function test-run a.ts
tailor function --json=false test-run a.ts
tailor --profile dev function test-run a.ts
