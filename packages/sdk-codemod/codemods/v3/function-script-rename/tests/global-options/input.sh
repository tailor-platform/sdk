tailor --json function script resolvers/add.ts
tailor function --verbose script resolvers/add.ts
tailor -e .env function script resolvers/add.ts --arg '{"a":1}'
tailor.cmd --env-file=.env function script resolvers/add.ts
tailor-sdk --envFileIfExists .env.local function -j script resolvers/add.ts
tailor -je .env function script resolvers/add.ts
tailor --no-json function script resolvers/add.ts
