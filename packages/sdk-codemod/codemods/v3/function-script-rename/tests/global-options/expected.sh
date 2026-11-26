tailor --json function scaffold resolvers/add.ts
tailor function --verbose scaffold resolvers/add.ts
tailor -e .env function scaffold resolvers/add.ts --arg '{"a":1}'
tailor.cmd --env-file=.env function scaffold resolvers/add.ts
tailor-sdk --envFileIfExists .env.local function -j scaffold resolvers/add.ts
tailor -je .env function scaffold resolvers/add.ts
tailor --no-json function scaffold resolvers/add.ts
