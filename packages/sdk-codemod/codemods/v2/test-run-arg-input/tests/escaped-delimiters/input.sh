tailor-sdk function test-run a.ts --name foo\&bar --arg '{"input":{"a":1}}'
tailor-sdk function test-run a.ts --name foo\|bar --arg '{"input":{"a":1}}'
tailor-sdk function test-run a.ts --name foo\;bar --arg '{"input":{"a":1}}'
tailor-sdk function test-run a.ts --arg '{"input":{"a":1}}' && other-cli --arg '{"input":{"b":2}}'
