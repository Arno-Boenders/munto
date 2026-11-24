// AI providers: one prompt and answer format, sent the way each provider expects, the answer parsed.
// A fake fetch stands in for the network: nothing is sent anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './fixture.js';

const { dir } = await setup({ today: '2026-10-16' });
process.env.CLAUDE_BIN = process.execPath; // something that exists where Claude Code would be
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'PERPLEXITY_API_KEY']) delete process.env[k];
const ai = await import('../src/ai.js');

const SCHEMA = { type: 'object', properties: { euros: { type: 'integer', minimum: 0 }, format: { type: 'string', maxLength: 5 } }, required: ['euros', 'format'], additionalProperties: false };
const sent = [];
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fake(handler) {
  ai.useFetch(async (url, init = {}) => {
    const req = { url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ? JSON.parse(init.body) : null };
    sent.push(req);
    return handler(req);
  });
}

test('schemas lose what providers reject, but keep fields whatever they are called', () => {
  assert.deepEqual(ai.plainSchema(SCHEMA), { type: 'object', properties: { euros: { type: 'integer' }, format: { type: 'string' } }, required: ['euros', 'format'], additionalProperties: false });
});

test('before anything is chosen: off, even with Claude Code installed', () => {
  const s = ai.aiSettings();
  assert.deepEqual([s.provider, s.chosen, ai.aiConfigured(s)], ['off', false, false]);
  assert.match(ai.aiMissingMessage(s), /AI is off/);
});

test('OpenAI: chat completions with a strict json_schema, key as a bearer token', async () => {
  fake(() => reply({ choices: [{ message: { content: '{"euros":12,"format":"x"}' } }] }));
  const answer = await ai.runModel('prompt', { system: 'sys', schema: SCHEMA }, { provider: 'openai', key: 'sk-test', model: 'gpt-x' });
  assert.deepEqual(answer, { euros: 12, format: 'x' });
  const r = sent.at(-1);
  assert.equal(r.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(r.headers.authorization, 'Bearer sk-test');
  assert.deepEqual(r.body.response_format.json_schema.schema.properties.euros, { type: 'integer' });
  assert.equal(r.body.response_format.json_schema.strict, true);
  assert.deepEqual(r.body.messages.map((m) => m.role), ['system', 'user']);
});

test('Perplexity: the Agent API with a json_schema, no web search, the text from the message output', async () => {
  fake(() => reply({ id: 'r1', status: 'completed', output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: '{"euros":5,' }, { type: 'output_text', text: '"format":"v"}' }] },
  ] }));
  const answer = await ai.runModel('prompt', { system: 'sys', schema: SCHEMA }, { provider: 'perplexity', key: 'pplx-test', model: 'anthropic/claude-sonnet-5' });
  assert.deepEqual(answer, { euros: 5, format: 'v' });
  const r = sent.at(-1);
  assert.equal(r.url, 'https://api.perplexity.ai/v1/agent');
  assert.equal(r.headers.authorization, 'Bearer pplx-test');
  assert.deepEqual([r.body.instructions, r.body.input], ['sys', 'prompt']);
  assert.equal(r.body.response_format.json_schema.name, 'answer');
  assert.deepEqual(r.body.response_format.json_schema.schema, ai.plainSchema(SCHEMA));
  assert.equal(r.body.tools, undefined, 'no web search with your merchants');
  assert.ok(r.body.max_output_tokens > 0, 'Anthropic models through Perplexity need it');
});

test('Perplexity: an answer that didn’t finish says so', async () => {
  fake(() => reply({ id: 'r2', status: 'failed', output: [], error: { code: 'x', message: 'Model overloaded' } }));
  await assert.rejects(ai.runModel('p', { system: 's', schema: SCHEMA }, { provider: 'perplexity', key: 'k', model: 'perplexity/sonar' }), /Perplexity: Model overloaded/);
});

test('Perplexity: the model list comes from Perplexity', async () => {
  fake(() => reply({ object: 'list', data: [{ id: 'perplexity/sonar' }, { id: 'anthropic/claude-sonnet-5' }] }));
  assert.deepEqual(await ai.listModels('perplexity', 'pplx-test'), ['anthropic/claude-sonnet-5', 'perplexity/sonar']);
  assert.equal(sent.at(-1).url, 'https://api.perplexity.ai/v1/models');
});

test('Gemini: responseJsonSchema, and the schema in the instructions where a model rejects that', async () => {
  let calls = 0;
  fake(() => (++calls === 1 ? reply({ error: { message: 'Unknown name "responseJsonSchema"' } }, 400)
    : reply({ candidates: [{ content: { parts: [{ text: '```json\n{"euros":3,"format":"y"}\n```' }] } }] })));
  const answer = await ai.runModel('prompt', { system: 'sys', schema: SCHEMA }, { provider: 'gemini', key: 'AIza-test', model: 'gemini-x' });
  assert.deepEqual(answer, { euros: 3, format: 'y' });
  const [first, second] = sent.slice(-2);
  assert.equal(first.headers['x-goog-api-key'], 'AIza-test');
  assert.ok(first.body.generationConfig.responseJsonSchema);
  assert.equal(second.body.generationConfig.responseJsonSchema, undefined);
  assert.match(second.body.systemInstruction.parts[0].text, /matching this JSON schema/);
});

test('Ollama: on this computer, with the schema as format', async () => {
  fake(() => reply({ message: { content: '{"euros":0,"format":"z"}' } }));
  const answer = await ai.runModel('prompt', { system: 'sys', schema: SCHEMA }, { provider: 'ollama', model: 'llama', ollamaUrl: 'http://127.0.0.1:11434' });
  assert.deepEqual(answer, { euros: 0, format: 'z' });
  assert.equal(sent.at(-1).url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(sent.at(-1).body.stream, false);
});

test('Claude API: the official SDK, structured output, low effort and the default fallback', async () => {
  fake(() => reply({ id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"euros":7,"format":"w"}' }], usage: { input_tokens: 1, output_tokens: 1 } }));
  const answer = await ai.runModel('prompt', { system: 'sys', schema: SCHEMA }, { provider: 'anthropic', key: 'sk-ant-test', model: 'claude-opus-5-5' });
  assert.deepEqual(answer, { euros: 7, format: 'w' });
  const r = sent.at(-1);
  assert.match(r.url, /\/v1\/messages/);
  assert.equal(r.headers['x-api-key'], 'sk-ant-test');
  assert.deepEqual(r.body.output_config, { format: { type: 'json_schema', schema: ai.plainSchema(SCHEMA) }, effort: 'low' });
  assert.equal(r.body.fallbacks, 'default');
  assert.match(r.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
});

test('a provider error says who and why, and an answer in the wrong shape is caught', async () => {
  fake(() => reply({ error: { message: 'Incorrect API key provided' } }, 401));
  await assert.rejects(ai.runModel('p', { system: 's', schema: SCHEMA }, { provider: 'openai', key: 'bad', model: 'gpt-x' }), /OpenAI: Incorrect API key provided \(401\)/);
  fake(() => reply({ choices: [{ message: { content: 'sure, here you go' } }] }));
  await assert.rejects(ai.runModel('p', { system: 's', schema: SCHEMA }, { provider: 'openai', key: 'k', model: 'gpt-x' }), /expected format/);
});

test('saving the choice: the key stays in settings.json, and the status never shows it', () => {
  ai.saveAi({ provider: 'openai', model: 'gpt-x', key: 'sk-secret-1234' });
  const s = ai.aiSettings();
  assert.deepEqual([s.provider, s.model, s.key, ai.aiConfigured(s), ai.aiName(s)], ['openai', 'gpt-x', 'sk-secret-1234', true, 'OpenAI']);
  ai.saveAi({ provider: 'openai', model: 'gpt-y' }); // no new key: the old one stays
  assert.equal(ai.aiSettings().key, 'sk-secret-1234');
  const status = JSON.stringify(ai.aiStatus());
  assert.ok(!status.includes('sk-secret'), 'never the key itself');
  assert.equal(ai.aiStatus().keys.openai, '…1234');
  assert.match(readFileSync(join(dir, 'settings.json'), 'utf8'), /"provider": "openai"/);
  assert.throws(() => ai.saveAi({ provider: 'ollama', ollamaUrl: 'file:///etc' }), /http/);
});

test('Ollama only on this computer or your own network; odd provider names are refused', () => {
  assert.equal(ai.checkOllamaUrl('http://127.0.0.1:11434/x'), 'http://127.0.0.1:11434');
  assert.equal(ai.checkOllamaUrl('http://192.168.1.20:11434'), 'http://192.168.1.20:11434');
  assert.throws(() => ai.checkOllamaUrl('http://example.com:11434'), /your own network/);
  assert.throws(() => ai.checkOllamaUrl('http://me:pw@127.0.0.1:11434'), /name or password/);
  assert.throws(() => ai.saveAi({ provider: '__proto__' }), /Unknown/);
  assert.throws(() => ai.saveAi({ provider: 'toString' }), /Unknown/);
});

test('sorting without amounts: the AI only learns whether money went in or out', async () => {
  const { suggestionInput } = await import('../src/suggest.js');
  const groups = [{ key: 'SHOP', txs: [{ booking_date: '2026-10-01', amount_cents: -1250, counterparty: 'Shop', description: 'card' }, { booking_date: '2026-10-02', amount_cents: 500, counterparty: 'Shop', description: 'refund' }] }];
  assert.equal(suggestionInput(groups)[0].examples[0].amount, '-12.50');
  const plain = suggestionInput(groups, { amounts: false });
  assert.ok(!JSON.stringify(plain).includes('12.5') && !JSON.stringify(plain).includes('amount'));
  assert.deepEqual(plain[0].examples.map((e) => e.direction), ['out', 'in']);
  ai.saveAi({ provider: 'openai', sendAmounts: false, auto: false });
  assert.deepEqual([ai.aiSettings().sendAmounts, ai.aiSettings().auto], [false, false]);
  ai.saveAi({ provider: 'openai' }); // not given: stays as it was
  assert.deepEqual([ai.aiSettings().sendAmounts, ai.aiSettings().auto], [false, false]);
});
