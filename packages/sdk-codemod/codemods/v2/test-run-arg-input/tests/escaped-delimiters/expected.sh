tailor-sdk function test-run a.ts --name foo\&bar --arg '{"a":1}'
tailor-sdk function test-run a.ts --name foo\|bar --arg '{"a":1}'
tailor-sdk function test-run a.ts --name foo\;bar --arg '{"a":1}'
tailor-sdk function test-run a.ts --arg '{"a":1}' && other-cli --arg '{"input":{"b":2}}'
