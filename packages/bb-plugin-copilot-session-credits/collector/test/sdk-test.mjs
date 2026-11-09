// Fully offline SDK/extension integration. Synthetic amounts are NOT billing evidence.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createProbe } from '../probe.mjs';
// Locate the installed Pi package: $PI_PACKAGE_DIR, else the `pi` binary's package, else the global npm root.
const PKG = '@earendil-works/pi-coding-agent';
const installed = (() => {
  const found = [process.env.PI_PACKAGE_DIR];
  try {
    let dir = dirname(realpathSync(execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()));
    for (; dir !== dirname(dir); dir = dirname(dir)) {
      const manifest = join(dir, 'package.json');
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === PKG) { found.push(dir); break; }
    }
  } catch {}
  try { found.push(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), PKG)); } catch {}
  const hit = found.find(dir => dir && existsSync(join(dir, 'dist/index.js')));
  if (!hit) { console.error(`Pi (${PKG}) not found. Install Pi or set PI_PACKAGE_DIR.`); process.exit(2); }
  return realpathSync(hit);
})();
globalThis.fetch = async () => { throw new Error('External fetch forbidden'); };
const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ModelRuntime } = await import(installed + '/dist/index.js');
const ai = [join(installed, 'node_modules/@earendil-works/pi-ai/dist/providers/all.js'), join(installed, '../pi-ai/dist/providers/all.js')].find(existsSync);
const { builtinProviders } = await import(ai);
const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-probe-sdk-'))), results = [];
let session, calls = 0, wrapped;
const frame = data => `event: ${data.type ?? 'message'}\ndata: ${JSON.stringify(data)}\n\n`;
try {
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: join(root, 'models.json') });
  await modelRuntime.setRuntimeApiKey('github-copilot', 'SYNTHETIC-NOT-A-CREDENTIAL');
  const model = { id: 'probe-fixture', name: 'probe-fixture', provider: 'github-copilot', api: 'openai-responses', baseUrl: 'http://127.0.0.1:1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 64 };
  const native = builtinProviders().find(provider => provider.id === 'github-copilot');
  const transport = api => async input => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1'); calls++;
    const billing = calls === 2 ? {} : { copilot_usage: { total_nano_aiu: '1230000000' } };
    const response = { id: `synthetic-${calls}`, status: 'completed', output: [], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } };
    let body;
    if (api === 'openai-responses') body = frame({ type: 'response.created', response: { id: response.id } }) + frame({ type: 'response.completed', response, ...billing }) + 'data: [DONE]\n\n';
    if (api === 'openai-completions') {
      const chunk = (amount, finish_reason) => ({ id: response.id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason }], copilot_usage: { total_nano_aiu: amount } });
      body = [chunk('0', null), chunk('0', null), chunk('7566900000', 'stop')].map(data => 'data: ' + JSON.stringify(data) + '\n\n').join('') + 'data: [DONE]\n\n';
    }
    if (api === 'anthropic-messages') body = frame({ type: 'message_start', message: { id: response.id, role: 'assistant', content: [], model: model.id, usage: { input_tokens: 2, output_tokens: 0 } } }) + frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 2, output_tokens: 1 }, ...billing }) + frame({ type: 'message_stop' });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };
  // Preserve the real native provider and its three API dispatchers; replace only test transport/catalog.
  const fixture = { ...native, getModels: () => [model], getAllModels: () => [model] };
  for (const method of ['stream', 'streamSimple']) fixture[method] = (chosen, context, options) => native[method](chosen, context, { ...options, apiKey: 'SYNTHETIC-NOT-A-CREDENTIAL', fetch: transport(chosen.api) });
  const loaderOptions = { cwd: root, agentDir: root, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true };
  const resourceLoader = new DefaultResourceLoader({ ...loaderOptions, systemPrompt: 'Offline synthetic test only.', extensionFactories: [pi => createProbe({ directory: join(root, 'receipts'), autoStart: true, provider: fixture })({ on: (...args) => pi.on(...args), registerCommand: (...args) => pi.registerCommand(...args), registerProvider: value => { wrapped = value; pi.registerProvider(value); } })] });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  ({ session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime, model, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(root), tools: [], thinkingLevel: 'off' }));
  await session.bindExtensions({});
  await session.prompt('SYNTHETIC-PROMPT-SECRET');
  await session.prompt('SYNTHETIC-PROMPT-SECRET');
  assert.equal(calls, 2);
  results.push({ name: 'Real Pi SDK registers full native-provider wrapper and captures synthetic inference', status: 'passed' });
  const context = { messages: [{ role: 'user', content: 'SYNTHETIC-PROMPT-SECRET', timestamp: 0 }] };
  for (const [api, method] of [['openai-completions', 'stream'], ['anthropic-messages', 'streamSimple']]) {
    let raw = 0, responses = 0;
    const stream = wrapped[method]({ ...model, api }, context, { onResponse: () => { responses++; }, onProviderStreamEvent: () => { raw++; } });
    for await (const event of stream) assert.notEqual(event.type, 'error');
    assert.equal((await stream.result()).stopReason, 'stop');
    assert(raw > 0); assert.equal(responses, 1);
  }
  await Promise.resolve();
  const raw = readdirSync(join(root, 'receipts')).map(file => readFileSync(join(root, 'receipts', file), 'utf8')).join('');
  const rows = raw.trim().split('\n').map(JSON.parse);
  assert(!raw.includes('SYNTHETIC-PROMPT-SECRET')); assert(!raw.includes('SYNTHETIC-NOT-A-CREDENTIAL'));
  const observations = rows.filter(row => row.kind === 'observation');
  assert.equal(observations.filter(row => row.billing.length).length, 5);
  assert(observations.every(row => row.callId));
  assert.equal(new Set(rows.filter(row => row.kind === 'call_started').map(row => row.callId)).size, 4);
  assert.equal(rows.filter(row => row.kind === 'call_finished').length, 4);
  assert.equal(rows.find(row => row.billing?.length).billing[0].nanoAiu, '1230000000');
  const before = calls;
  await session.prompt('/copilot-probe off');
  assert.equal(calls, before, 'local command must not invoke model');
  results.push({ name: 'Native three-route dispatch and original callbacks survive wrapping; no content leaks or billable command', status: 'passed' });
  // A separate BB-bound capture exercises the same real native dispatcher through the host reader.
  const providerSession = 'pi_11111111-1111-4111-8111-111111111111', directory = join(root, 'bb-receipts'), hooks = new Map();
  let bbProvider;
  createProbe({ directory, autoStart: true, provider: fixture })({ on: (name, run) => hooks.set(name, run), registerCommand() {}, registerProvider: value => { bbProvider = value; } });
  hooks.get('session_start')({ reason: 'startup' }, { sessionManager: { getSessionId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', getSessionFile: () => join(root, providerSession + '.jsonl') } });
  const bbStream = bbProvider.stream({ ...model, api: 'openai-completions' }, context, {});
  for await (const event of bbStream) assert.notEqual(event.type, 'error');
  assert.equal((await bbStream.result()).stopReason, 'stop'); await Promise.resolve();
  const { createHostEntry } = await import('../../dist/host.js');
  const { experimental_createHostEntryHarness } = await import('@get-bb/plugin-sdk/testing/host');
  const host = experimental_createHostEntryHarness(createHostEntry([directory], join(root, 'unused-cli'), join(root, 'unused-status')));
  try {
    const usage = await host.experimental_call('read', { provider: 'pi', sessionId: providerSession });
    assert.equal(usage.aic, '7.5669'); assert.equal(usage.reported, 1); assert.equal(usage.conflicting, 0); assert.equal(usage.coverage, 'partial'); assert.equal(usage.captureIssue, false);
    assert.equal((await host.experimental_call('read', { provider: 'pi', sessionId: 'pi_99999999-9999-4999-8999-999999999999' })).aic, null);
    const receipts = readdirSync(directory).map(file => readFileSync(join(directory, file), 'utf8')).join('');
    assert(!receipts.includes('SYNTHETIC-PROMPT-SECRET')); assert(!receipts.includes('SYNTHETIC-NOT-A-CREDENTIAL'));
    results.push({ name: 'Native Chat streaming zero placeholders then final 7.5669 AIC survive receipts and exact-session host accounting', status: 'passed' });
  } finally { await host.experimental_dispose(); hooks.get('session_shutdown')({ reason: 'quit' }); }
  console.log(JSON.stringify(results, null, 2));
} finally { session?.dispose(); rmSync(root, { recursive: true, force: true }); }
