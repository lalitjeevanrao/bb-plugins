import { constants, mkdirSync, rmdirSync, unlinkSync, lstatSync, realpathSync, fstatSync, readdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

const APIS = new Set(['openai-responses', 'openai-completions', 'anthropic-messages']);
const TYPES = new Set(['response.created', 'response.completed', 'response.incomplete', 'response.failed', 'error', 'chat.completion.chunk', 'message_start', 'message_delta', 'message_stop', 'copilot_usage']);
const TERMINAL = new Set(['response.completed', 'response.incomplete', 'response.failed', 'error', 'message_stop']);
const REASONS = new Set(['startup', 'quit', 'reload', 'new', 'resume', 'fork']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const recordObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeLabel = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value) ? value : 'unknown';
const hash = (domain, value) => createHash('sha256').update(domain + '\0' + value).digest('hex');

// Only these candidate paths are inspected. No recursive raw-event logging.
export function observeBilling(data) {
  if (!recordObject(data)) return [];
  const candidates = [['copilot_usage', data.copilot_usage], ['response.copilot_usage', data.response?.copilot_usage], ['usage.copilot_usage', data.usage?.copilot_usage]];
  if (data.type === 'copilot_usage') candidates.push(['', data]);
  return candidates.flatMap(([path, value]) => {
    if (!recordObject(value)) return [];
    const field = `${path ? path + '.' : ''}total_nano_aiu`;
    if (!Object.hasOwn(value, 'total_nano_aiu')) return [{ path: field, missingAmount: true }];
    const amount = value.total_nano_aiu;
    const valid = typeof amount === 'string' ? /^\d{1,40}$/.test(amount) : Number.isSafeInteger(amount) && amount >= 0;
    // Parsed numbers cannot prove the precision of the original JSON text.
    return [valid ? { path: field, nanoAiu: BigInt(amount).toString(), valueType: typeof amount } : { path: field, invalid: true }];
  });
}

// Retain only phase evidence, never the raw chunk or finish reason.
function chatBillingPhase(data) {
  if ((data.object !== 'chat.completion.chunk' && data.type !== 'chat.completion.chunk') || !Array.isArray(data.choices)) return 'unknown';
  if (!data.choices.length) return recordObject(data.usage) ? 'final' : 'unknown';
  const choice = data.choices[0];
  if (data.choices.length !== 1 || !recordObject(choice) || choice.index !== 0) return 'unknown';
  if (choice.finish_reason == null) return 'interim';
  return ['stop', 'length', 'tool_calls', 'function_call'].includes(choice.finish_reason) ? 'final' : 'unknown';
}
// All schema-3 writers reserve files under the same atomic mkdir lock. No evidence is deleted.
function openCapture(directory, epoch, maxFiles) {
  if (realpathSync(dirname(directory)) !== dirname(directory)) throw new Error('Canonical parent required');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const dir = lstatSync(directory);
  if (realpathSync(directory) !== directory || !dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) !== 0 || (process.getuid && dir.uid !== process.getuid())) throw new Error('Private directory required');
  const lock = join(directory, '.capture-lock'), file = join(directory, `${epoch}.jsonl`);
  let locked = false, fd, fileStat;
  try {
    // ponytail: skip contended calls, retry next call; never steal a crash-left lock.
    try { mkdirSync(lock, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') return undefined; throw error; } locked = true;
    if (readdirSync(directory).filter(name => name !== '.capture-lock').length >= maxFiles) throw new Error('Capture directory full');
    fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fileStat = fstatSync(fd);
    const after = lstatSync(directory);
    if (!fileStat.isFile() || fileStat.nlink !== 1 || (fileStat.mode & 0o077) !== 0 || (process.getuid && fileStat.uid !== process.getuid()) || realpathSync(directory) !== directory || after.dev !== dir.dev || after.ino !== dir.ino) throw new Error('Capture destination changed');
    return fd;
  } catch (error) {
    if (fd !== undefined) {
      // Remove only this failed creation, never a swapped path or pre-existing evidence.
      try {
        const current = lstatSync(file), after = lstatSync(directory);
        const opened = fileStat ?? fstatSync(fd);
        if (realpathSync(directory) === directory && after.dev === dir.dev && after.ino === dir.ino && current.dev === opened.dev && current.ino === opened.ino) unlinkSync(file);
      } catch {}
      try { closeSync(fd); } catch {}
    }
    throw error;
  } finally { if (locked) { try { rmdirSync(lock); } catch {} } }
}

export function createProbe({ directory, provider, autoStart = false, maxBytes = 1_048_576, maxRecords = 10_000, maxFiles = 256, onStatus = () => {} }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 512 || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 256) throw new Error('Invalid capture limits');
  if (provider?.id !== 'github-copilot' || typeof provider.stream !== 'function' || typeof provider.streamSimple !== 'function') throw new Error('Native Copilot provider required');
  directory = resolve(directory);
  return pi => {
    let enabled = autoStart, base, capture, failed = false, missedCalls = 0;
    const status = () => { try { onStatus(!enabled ? 'disabled' : failed ? 'error' : 'ready'); } catch {} };
    const fail = () => { failed = true; status(); };
    const guard = run => (event, ctx) => { try { run(event, ctx); } catch { fail(); } };
    const stop = reason => {
      if (capture) { capture.write('capture_stopped', { reason, ...capture.counts() }); capture.close(); capture = undefined; }
    };
    const setSession = (event, ctx) => {
      stop(REASONS.has(event.reason) ? event.reason : 'session-changed'); base = undefined; failed = false; missedCalls = 0;
      const id = ctx.sessionManager.getSessionId();
      if (typeof id !== 'string' || !UUID.test(id)) { fail(); return; }
      const file = ctx.sessionManager.getSessionFile(), name = typeof file === 'string' ? basename(file, '.jsonl') : '';
      base = { nativeSessionHash: hash('pi-session-v2', id.toLowerCase()), providerSession: name.startsWith('pi_') && UUID.test(name.slice(3)) ? name : null, reason: REASONS.has(event.reason) ? event.reason : 'unknown', previousSession: typeof event.previousSessionFile === 'string' };
    };
    // Lazy: session startup, status and non-Copilot activity never allocate files.
    const ensure = () => {
      if (!enabled || !base || failed) return undefined;
      if (capture) return capture;
      const epoch = randomUUID(), identity = { epoch, nativeSessionHash: base.nativeSessionHash, providerSession: base.providerSession };
      let fd;
      try { fd = openCapture(directory, epoch, maxFiles); } catch { fail(); return undefined; }
      if (fd === undefined) { missedCalls++; return undefined; }
      let bytes = 0, records = 0, dropped = 0, rawEvents = 0, amountObservations = 0, truncated = false, inFlight = 0;
      const close = () => { if (fd !== undefined) { try { closeSync(fd); } catch {} fd = undefined; } };
      const write = (kind, fields = {}) => {
        if (fd === undefined || truncated) { dropped++; return; }
        try {
          let line = JSON.stringify({ schema: 3, seq: records + 1, kind, at: new Date().toISOString(), ...identity, coverage: 'provider-wrapper-partial', ...fields }) + '\n';
          let size = Buffer.byteLength(line);
          if (records >= maxRecords - 1 || bytes + size > maxBytes - 512) {
            dropped++; truncated = true;
            line = JSON.stringify({ schema: 3, seq: records + 1, kind: 'capture_truncated', at: new Date().toISOString(), ...identity, coverage: 'provider-wrapper-partial', reason: 'capture-limit', droppedAtLeast: dropped }) + '\n';
            size = Buffer.byteLength(line);
            if (bytes + size > maxBytes) return;
          }
          const buffer = Buffer.from(line); let written = 0;
          while (written < buffer.length) {
            const count = writeSync(fd, buffer, written, buffer.length - written);
            if (count === 0) throw new Error('Capture write stopped');
            written += count;
          }
          bytes += size; records++;
        } catch { dropped++; fail(); close(); }
      };
      capture = {
        write, close,
        counts: () => ({ rawEvents, amountObservations, dropped, inFlight }),
        startCall: fields => { inFlight++; write('call_started', fields); },
        finishCall: fields => { inFlight--; write('call_finished', fields); },
        observe: (callId, model, data) => {
          rawEvents++;
          if (!recordObject(data)) return;
          const eventType = TYPES.has(data.type) ? data.type : data.object === 'chat.completion.chunk' ? 'chat.completion.chunk' : 'other';
          const billing = observeBilling(data);
          amountObservations += billing.filter(value => Object.hasOwn(value, 'nanoAiu')).length;
          if (billing.length || TERMINAL.has(eventType) || data.choices?.some?.(choice => choice.finish_reason != null)) {
            const responseId = data.response?.id ?? data.message?.id ?? data.id;
            write('observation', { callId, provider: 'github-copilot', api: model.api, model: safeLabel(model.id), eventType, responseHash: typeof responseId === 'string' && responseId.length > 0 && responseId.length <= 512 ? hash('pi-response-v2', responseId) : null, ...(model.api === 'openai-completions' ? { billingPhase: chatBillingPhase(data) } : {}), billing });
          }
        }
      };
      write('capture_started', { source: 'native-provider-wrapper', billingSemantics: 'unverified', missedCalls, reason: base.reason, previousSession: base.previousSession, ...capture.counts() });
      return capture;
    };
    const wrap = method => (model, context, options) => {
      let target, callId;
      try {
        if (model.provider === 'github-copilot' && APIS.has(model.api)) target = ensure();
        if (target) { callId = randomUUID(); target.startCall({ callId, api: model.api, model: safeLabel(model.id), method }); }
      } catch { fail(); }
      const finish = outcome => { try { target?.finishCall({ callId, outcome }); } catch { fail(); } };
      const wrapped = target ? { ...options, onProviderStreamEvent: async (data, originalModel) => {
        try { target.observe(callId, model, data); } catch { fail(); }
        return options?.onProviderStreamEvent?.(data, originalModel);
      } } : options;
      let stream;
      try { stream = provider[method].call(provider, model, context, wrapped); }
      catch (error) { finish('threw'); throw error; }
      // Observe settlement without replacing/consuming the original stream, options or callbacks.
      if (target) {
        try { void Promise.resolve(stream.result()).then(result => finish(['stop', 'length', 'toolUse', 'error', 'aborted'].includes(result?.stopReason) ? result.stopReason : 'unknown'), () => finish('rejected')); }
        catch { fail(); }
      }
      return stream;
    };
    pi.registerProvider({ ...provider, stream: wrap('stream'), streamSimple: wrap('streamSimple') });
    // No provider_stream_event collector: it would duplicate the wrapper's observations.
    pi.on('session_start', guard((event, ctx) => { setSession(event, ctx); status(); }));
    pi.on('agent_end', guard(() => { if (capture) capture.write('capture_checkpoint', capture.counts()); }));
    pi.on('session_shutdown', guard(event => { stop(REASONS.has(event.reason) ? event.reason : 'unknown'); base = undefined; }));
    pi.registerCommand('copilot-probe', {
      description: 'Local credit probe: on, off, status (never invokes model)',
      handler: async (args, ctx) => {
        const action = args.trim() || 'status';
        if (!['on', 'off', 'status'].includes(action)) { ctx.ui.notify('Usage: /copilot-probe on|off|status', 'warning'); return; }
        if (action === 'off') { stop('command'); enabled = false; }
        if (action === 'on') { enabled = true; failed = false; if (!base) { try { setSession({}, ctx); } catch { fail(); } } }
        status();
        if (capture) capture.write('capture_status', capture.counts());
        const counts = capture?.counts(), contended = enabled && !capture && missedCalls > 0;
        ctx.ui.notify(`Copilot probe: ${enabled ? failed ? 'capture-error' : contended ? 'capture-contended' : 'on' : 'off'}; observations=${counts?.amountObservations ?? 0}; missedCalls=${missedCalls}; dropped=${counts?.dropped ?? 0}; coverage=partial`, failed || contended ? 'warning' : 'info');
      }
    });
  };
}
