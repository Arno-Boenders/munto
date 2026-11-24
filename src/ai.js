// The AI behind sorting suggestions, the suggested budget and the ranked tips. One setting picks the
// provider (settings.json in your data folder, set on the Settings page); every provider gets the same
// prompt and the same answer format (a JSON schema), and returns the parsed answer. What's sent is the same
// for all of them (merchant names and amounts, or monthly totals), and the answers are checked afterwards in
// suggest.js (known pots only, no negative amounts), so a weaker model can't save nonsense.
//   claude-code  the Claude Code CLI on your Claude subscription (no key)
//   anthropic    the Claude API, with an Anthropic API key
//   openai       the OpenAI API, with an OpenAI API key
//   gemini       the Google Gemini API, with a Gemini API key
//   perplexity   Perplexity's Agent API, with a Perplexity API key (models from several makers, no web search)
//   ollama       a local model through Ollama: nothing leaves your computer
//   off          rules and sorting by hand still do everything
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadSettings, saveSettings } from './settings.js';

export const PROVIDERS = {
  'claude-code': { name: 'Claude Code', short: 'Claude', sentTo: 'Anthropic, through Claude Code on your Claude subscription', needsKey: false },
  anthropic: { name: 'Claude API', short: 'Claude', sentTo: 'Anthropic', needsKey: true, keyHint: 'sk-ant-…', keysUrl: 'https://platform.claude.com/settings/keys' },
  openai: { name: 'OpenAI API (ChatGPT)', short: 'OpenAI', sentTo: 'OpenAI', needsKey: true, keyHint: 'sk-…', keysUrl: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Google Gemini API', short: 'Gemini', sentTo: 'Google', needsKey: true, keyHint: 'AIza…', keysUrl: 'https://aistudio.google.com/apikey' },
  perplexity: { name: 'Perplexity API', short: 'Perplexity', sentTo: 'Perplexity, and the maker of the model you pick (e.g. Anthropic or OpenAI)', needsKey: true, keyHint: 'pplx-…', keysUrl: 'https://console.perplexity.ai/project/keys' },
  ollama: { name: 'Ollama (on this computer)', short: 'Ollama', sentTo: 'nobody: the model runs on this computer', needsKey: false },
  off: { name: 'Off', short: 'AI', sentTo: 'nobody', needsKey: false },
};
const OLLAMA = 'http://127.0.0.1:11434';
const known = (provider) => typeof provider === 'string' && Object.hasOwn(PROVIDERS, provider);

// Ollama only on this computer or your own network (never an address on the internet), without credentials.
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;
const PRIVATE = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|[\w-]+\.local|\[f[cd][0-9a-f:]*\])$/i;
export function checkOllamaUrl(address) {
  let url;
  try { url = new URL(address); } catch { throw new Error('That isn’t a valid Ollama address, like http://127.0.0.1:11434'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The Ollama address must start with http://');
  if (url.username || url.password) throw new Error('The Ollama address can’t contain a name or password');
  if (!LOOPBACK.test(url.hostname) && !PRIVATE.test(url.hostname)) throw new Error('Ollama has to run on this computer or your own network (like 192.168.x.x)');
  return url.origin;
}
const isLocal = (address) => { try { return LOOPBACK.test(new URL(address).hostname); } catch { return false; } };
export const ENV_KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', perplexity: 'PERPLEXITY_API_KEY' };
// Tests swap in a fake fetch.
let request = (...args) => fetch(...args);
export const useFetch = (f) => { request = f; };

// ---------- settings ----------

const CLAUDE = () => process.env.CLAUDE_BIN || 'claude';
// How to start Claude Code. On Windows it's claude.exe (Anthropic's installer), started directly, or
// claude.cmd (npm), which Node can't start without a shell: then its cli.js runs with node instead, so the
// prompt and schema are passed as they are, never through cmd.exe's quoting.
let claudeCmd;
function claudeCommand() {
  if (claudeCmd) return claudeCmd;
  const bin = CLAUDE();
  claudeCmd = { file: bin, pre: [] };
  if (process.platform !== 'win32' || /\.exe$/i.test(bin)) return claudeCmd;
  let found = [];
  try { found = execFileSync('where', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).filter(Boolean); } catch { /* not on PATH */ }
  const exe = found.find((f) => /\.exe$/i.test(f));
  const cmd = found.find((f) => /\.cmd$/i.test(f));
  const cli = cmd && join(dirname(cmd), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  if (exe) claudeCmd = { file: exe, pre: [] };
  else if (cli && existsSync(cli)) claudeCmd = { file: 'node', pre: [cli] };
  return claudeCmd;
}
let cliFound;
export const claudeCodeFound = () => {
  if (cliFound == null) { const c = claudeCommand(); cliFound = spawnSync(/*turbopackIgnore: true*/ c.file, [...c.pre, '--version'], { stdio: 'ignore' }).status === 0; }
  return cliFound;
};

// The current choice. Off until you choose one on the Settings page, even when Claude Code is installed:
// nothing about your money goes to an AI you didn't pick.
export function aiSettings(env = process.env) {
  const s = loadSettings().ai ?? {};
  const provider = known(s.provider) ? s.provider : 'off';
  const key = PROVIDERS[provider].needsKey ? (s.keys?.[provider] || env[ENV_KEYS[provider]] || null) : null;
  const model = s.models?.[provider] || (provider === 'claude-code' ? env.SUGGEST_MODEL || 'sonnet' : provider === 'anthropic' ? 'claude-opus-5-5' : null);
  return {
    provider, model, key, ollamaUrl: s.ollamaUrl || OLLAMA, chosen: known(s.provider),
    // Sorting: with the amounts (or only names, descriptions and in/out), and as soon as there's something
    // to sort (or only when you click Ask). A budget and the tips are always only asked for when you click.
    sendAmounts: s.sendAmounts !== false, auto: s.auto !== false,
  };
}

export function aiConfigured(ai = aiSettings()) {
  if (ai.provider === 'off') return false;
  if (ai.provider === 'claude-code') return claudeCodeFound();
  if (PROVIDERS[ai.provider].needsKey && !ai.key) return false;
  return !!ai.model;
}

export const aiName = (ai = aiSettings()) => PROVIDERS[ai.provider].short;

export function aiMissingMessage(ai = aiSettings()) {
  if (ai.provider === 'off') return 'AI is off. Turn it on under Settings → Sorting with AI.';
  if (ai.provider === 'claude-code') return 'Claude Code was not found. Install it (claude.com/claude-code), run `claude` once to log in with your Claude subscription, then restart Munto. Or choose another AI under Settings.';
  if (!ai.key) return `Add your ${PROVIDERS[ai.provider].name} key under Settings → Sorting with AI.`;
  return 'Pick a model under Settings → Sorting with AI.';
}

// Saves the choice. A key is only replaced when a new one is given; keys stay in settings.json (600).
export function saveAi({ provider, model, key, ollamaUrl, sendAmounts, auto }) {
  if (!known(provider)) throw new Error('Unknown AI provider');
  const settings = loadSettings();
  const ai = settings.ai ?? {};
  ai.provider = provider;
  if (typeof sendAmounts === 'boolean') ai.sendAmounts = sendAmounts;
  if (typeof auto === 'boolean') ai.auto = auto;
  if (model) ai.models = { ...(ai.models ?? {}), [provider]: String(model).trim() };
  if (key && PROVIDERS[provider].needsKey) ai.keys = { ...(ai.keys ?? {}), [provider]: String(key).trim() };
  if (provider === 'ollama' && ollamaUrl) ai.ollamaUrl = checkOllamaUrl(ollamaUrl);
  settings.ai = ai;
  saveSettings(settings);
}

// What the Settings page may show about the choice: never the keys themselves.
export function aiStatus() {
  const ai = aiSettings();
  const s = loadSettings().ai ?? {};
  return {
    provider: ai.provider, model: ai.model, chosen: ai.chosen, configured: aiConfigured(ai), name: aiName(ai),
    claudeCode: claudeCodeFound(), ollamaUrl: ai.ollamaUrl, sendAmounts: ai.sendAmounts, auto: ai.auto,
    keys: Object.fromEntries(Object.keys(ENV_KEYS).map((p) => {
      const k = s.keys?.[p] || process.env[ENV_KEYS[p]];
      return [p, k ? `…${k.slice(-4)}` : null];
    })),
    models: s.models ?? {},
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({
      id, name: p.name, needsKey: p.needsKey, keyHint: p.keyHint ?? null, keysUrl: p.keysUrl ?? null,
      // Ollama on another computer of yours: say which one, not "nobody".
      sentTo: id === 'ollama' && !isLocal(ai.ollamaUrl) ? `your computer at ${new URL(ai.ollamaUrl).host}, through Ollama` : p.sentTo,
    })),
  };
}

// ---------- the answer format ----------

// Keywords some providers reject in a schema (e.g. `minimum`); the checks in suggest.js cover them instead.
const UNSUPPORTED = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'format']);
export function plainSchema(schema) {
  if (Array.isArray(schema)) return schema.map(plainSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => !UNSUPPORTED.has(k)).map(([k, v]) => {
    if (k === 'enum' || k === 'required') return [k, v];
    // Under `properties` the keys are field names (a field may be called "format"): keep them all.
    if (k === 'properties') return [k, Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, plainSchema(sub)]))];
    return [k, plainSchema(v)];
  }));
}

const parseJson = (text, who) => {
  try { return JSON.parse(String(text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Error(`${who} didn’t answer in the expected format`); }
};

async function readJson(res, who) {
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try { const j = JSON.parse(text); detail = j.error?.message ?? j.error ?? j.message ?? text; } catch { /* keep text */ }
    throw new Error(`${who}: ${String(detail).slice(0, 240)} (${res.status})`);
  }
  return JSON.parse(text);
}

// ---------- the providers ----------

// Runs `claude -p` with no tools, settings, MCP servers or saved session; the prompt goes in on stdin.
function viaClaudeCode(prompt, { system, schema }, ai) {
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--system-prompt', system,
    '--model', ai.model || 'sonnet', '--tools', '', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'];
  // Drop API keys so the CLI uses the subscription login rather than billing an API account.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return new Promise((resolve, reject) => {
    const c = claudeCommand();
    const child = spawn(/*turbopackIgnore: true*/ c.file, [...c.pre, ...args], { cwd: tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude took longer than 3 minutes')); }, 180_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(out); } catch { return reject(new Error(err.trim() || `claude exited with code ${code}`)); }
      if (result.is_error) return reject(new Error(String(result.result || 'Claude returned an error').slice(0, 300)));
      resolve(result.structured_output ?? JSON.parse(result.result));
    });
    child.stdin.end(prompt);
  });
}

// The Claude API through Anthropic's SDK, with structured output (output_config.format). Current models
// (Opus 5.5 and friends) always think; low effort keeps this quick and cheap. On a safety decline, the
// API's own fallback ("default") retries on a suitable model, for the models that support it.
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
async function viaAnthropic(prompt, { system, schema }, ai) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ai.key, fetch: request, maxRetries: 2 });
  const params = {
    model: ai.model, max_tokens: 16000, system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema: plainSchema(schema) }, ...(/^claude-(opus|sonnet|haiku|fable)-5/.test(ai.model) ? { effort: 'low' } : {}) },
  };
  const response = FALLBACK_MODELS.has(ai.model)
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params);
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to answer this one');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude’s answer was cut off: try again with fewer at a time');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseJson(text, 'Claude');
}

async function viaOpenAI(prompt, { system, schema }, ai) {
  const res = await request('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${ai.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: ai.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: plainSchema(schema) } },
    }),
  });
  const json = await readJson(res, 'OpenAI');
  const message = json.choices?.[0]?.message;
  if (message?.refusal) throw new Error('OpenAI declined to answer this one');
  return parseJson(message?.content, 'OpenAI');
}

// Gemini takes the schema as responseJsonSchema; where a model doesn't accept that, the schema goes in the
// instructions instead, and the answer is checked afterwards either way.
async function viaGemini(prompt, { system, schema }, ai) {
  const call = (generationConfig, sys) => request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': ai.key, 'content-type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
  });
  let res = await call({ responseMimeType: 'application/json', responseJsonSchema: plainSchema(schema) }, system);
  if (res.status === 400) {
    res = await call({ responseMimeType: 'application/json' }, `${system}\n\nAnswer with JSON only, matching this JSON schema:\n${JSON.stringify(plainSchema(schema))}`);
  }
  const json = await readJson(res, 'Gemini');
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) throw new Error(`Gemini gave no answer${json.candidates?.[0]?.finishReason ? ` (${json.candidates[0].finishReason})` : ''}`);
  return parseJson(text, 'Gemini');
}

// Perplexity's Agent API (its Sonar chat completions ended in Sept 2026). Models are named maker/model, e.g.
// perplexity/sonar or anthropic/claude-sonnet-5. No `tools`, so it doesn't search the web with your merchants.
const PERPLEXITY = 'https://api.perplexity.ai/v1';
async function viaPerplexity(prompt, { system, schema }, ai) {
  const res = await request(`${PERPLEXITY}/agent`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ai.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: ai.model, instructions: system, input: prompt, max_output_tokens: 16000, // required for anthropic/* models
      response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: plainSchema(schema) } },
    }),
  });
  const json = await readJson(res, 'Perplexity');
  if (json.status !== 'completed') throw new Error(`Perplexity: ${json.error?.message ?? `the answer is ${json.status}`}`);
  const text = (json.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  return parseJson(text, 'Perplexity');
}

async function viaOllama(prompt, { system, schema }, ai) {
  const res = await request(`${ai.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: ai.model, stream: false, format: plainSchema(schema), messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
  });
  const json = await readJson(res, 'Ollama');
  return parseJson(json.message?.content, 'Ollama');
}

const RUN = { 'claude-code': viaClaudeCode, anthropic: viaAnthropic, openai: viaOpenAI, gemini: viaGemini, perplexity: viaPerplexity, ollama: viaOllama };

// Sends one prompt to the chosen AI and returns its answer, parsed. `ai` overrides the saved choice (Test).
export async function runModel(prompt, { system, schema }, ai = aiSettings()) {
  if (!known(ai.provider) || !Object.hasOwn(RUN, ai.provider) && ai.provider !== 'off') throw new Error('Unknown AI provider');
  if (ai.provider === 'ollama') ai = { ...ai, ollamaUrl: checkOllamaUrl(ai.ollamaUrl) };
  if (!aiConfigured(ai)) throw new Error(aiMissingMessage(ai));
  return RUN[ai.provider](prompt, { system, schema }, ai);
}

// The models you can pick, from the provider itself (so the list is never out of date).
export async function listModels(provider, key, ollamaUrl = OLLAMA) {
  if (provider === 'claude-code') return ['sonnet', 'opus', 'haiku'];
  if (provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key, fetch: request });
    const ids = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
  if (provider === 'openai') {
    const json = await readJson(await request('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } }), 'OpenAI');
    return json.data.map((m) => m.id).filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(id)).sort();
  }
  if (provider === 'gemini') {
    const json = await readJson(await request('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } }), 'Gemini');
    return (json.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, '')).filter((id) => /^gemini/.test(id));
  }
  if (provider === 'perplexity') {
    const json = await readJson(await request(`${PERPLEXITY}/models`, { headers: { authorization: `Bearer ${key}` } }), 'Perplexity');
    return (json.data ?? []).map((m) => m.id).sort();
  }
  if (provider === 'ollama') {
    const json = await readJson(await request(`${checkOllamaUrl(ollamaUrl)}/api/tags`), 'Ollama');
    return (json.models ?? []).map((m) => m.name);
  }
  return [];
}

// A tiny request with the chosen settings: does it work?
export async function testAi(ai) {
  const answer = await runModel('Reply with ok set to true.', {
    system: 'You are a connection test. Answer with the JSON asked for.',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  }, ai);
  if (answer?.ok !== true) throw new Error('It answered, but not as expected');
  return true;
}
