tailor --json function run a.ts
tailor -e .env function run a.ts
tailor function --verbose run a.ts
tailor --env-file ".env local" --no-json function run a.ts
tailor -je .env function run a.ts
tailor function --json=false run a.ts
tailor --profile dev function test-run a.ts
