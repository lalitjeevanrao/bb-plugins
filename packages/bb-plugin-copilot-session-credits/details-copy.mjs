// Presentation only. Amounts and accounting precedence stay in accounting.mjs.
import { meterState } from './accounting.mjs';
const calls = n => `${n} ${n === 1 ? 'call' : 'calls'}`;
/** @param {any} usage @param {{stale?: boolean, provider?: string, sessionId?: string|null}} options */
export function creditDetails(usage, { stale = false, provider, sessionId } = {}) {
  const state = meterState(usage), issues = new Set(usage?.issues ?? []);
  const pi = provider === 'pi' || usage?.source === 'pi-receipts', cli = usage?.source === 'copilot-checkpoint';
  let label = state, tone = state === 'Recorded' ? 'good' : state === 'Updating' || state === 'Loading' ? 'info' : state === 'Unavailable' ? 'muted' : 'warn';
  let action = null;
  const notes = [];
  if (issues.has('capture-damaged')) { label = 'Missing data'; tone = 'bad'; notes.push('Some receipts could not be read safely.'); action = 'Check /copilot-probe status, then stop Pi before inspecting files and permissions.'; }
  if (issues.has('collector-full')) {
    if (tone !== 'bad') { label = 'Collector full'; tone = 'warn'; }
    notes.push('New captures blocked. The receipt folder is full.');
    action = 'Stop all Pi processes. Move receipts to a private archive outside the capture folder.';
  }
  if (issues.has('stale-lock')) { notes.push('Capture lock may be abandoned.'); action = 'Do not remove the lock while Pi runs. Stop Pi; see cleanup docs.'; }
  if (issues.has('allocation-busy')) { notes.push('Capture allocation is busy.'); action ??= 'Wait a moment. Check /copilot-probe status if it persists.'; }
  if (usage?.missing) notes.push(`${calls(usage.missing)} without credits. Not counted.`);
  if (usage?.conflicting) notes.push(`${calls(usage.conflicting)} with invalid or conflicting credits. Not counted.`);
  if (usage?.inFlight) { notes.push(`${calls(usage.inFlight)} unfinished. Not counted yet.`); action ??= 'If Pi is idle, check /copilot-probe status.'; }
  if (state === 'Missing data' && cli) { label = 'Copilot CLI partial'; notes.push('Copilot CLI reported partial coverage.'); action = 'Check Copilot CLI diagnostics. Missing usage cannot be reconstructed here.'; }
  if (state === 'Missing data' && !notes.length) { notes.push('Capture data is incomplete.'); action = 'Check /copilot-probe status in Pi.'; }
  if (state === 'Unavailable' && pi && !action) action = 'Check /copilot-probe status in the BB-managed Pi session.';
  const readiness = usage?.readiness?.state ?? 'unconfirmed';
  const awaiting = pi && readiness === 'ready' && usage?.aic == null && !usage?.observed && !usage?.reported && !usage?.inFlight && !usage?.missing && !usage?.conflicting && !usage?.captureIssue && issues.size === 0;
  const setup = pi && readiness === 'unconfirmed' && !stale && !issues.has('host-unavailable');
  if (pi && !issues.has('host-unavailable')) {
    if (readiness === 'unconfirmed') {
      label = 'Capture unconfirmed'; tone = 'warn';
      if (sessionId === null) notes.push('Session not started or identity pending. You can set up credits before the first call.');
      else if (/safely|ambiguous|Too many|alive/.test(usage?.readiness?.reason ?? '')) notes.push('Capture status could not be confirmed. Retry or check /copilot-probe status.');
      action = null;
    } else if (awaiting) { label = 'Ready'; tone = 'info'; action = null; }
    else if (readiness !== 'ready') {
      label = readiness === 'unsupported' ? 'Pi unsupported' : readiness === 'disabled' ? 'Capture off' : 'Capture error'; tone = 'warn';
      notes.push(usage?.readiness?.reason ?? 'Check /copilot-probe status.');
      action = readiness === 'disabled' ? 'Run /copilot-probe on in this Pi session.' : readiness === 'unsupported' ? 'Use an authenticated Pi 1.5.0+ runtime, then reload or restart Pi.' : 'Check /copilot-probe status and receipt-folder permissions.';
    }
  }
  if (issues.has('host-unavailable')) { label = 'Unavailable'; tone = 'bad'; notes.push("Cannot read this session's host."); action = 'Check the BB host connection.'; }
  if (stale) {
    label = 'Disconnected'; tone = 'warn';
    notes.unshift(usage?.aic != null ? 'Connection lost. Last value kept.' : 'Connection lost. No current reading.');
    action = 'Reconnect BB to refresh.';
  }
  return {
    label, tone, action, notes, setup,
    summary: pi ? awaiting ? 'Ready — awaiting Copilot usage.' : usage?.reported ? `${calls(usage.reported)} completed and counted.` : setup ? 'Pi capture not confirmed.' : 'No completed calls counted.' : cli ? 'Latest Copilot CLI total. Includes Copilot CLI subagents.' : usage?.reason ?? 'Reading usage…',
    scope: pi ? 'This Pi session. Other BB threads separate.' : cli ? 'This Copilot CLI session. Other BB threads separate.' : 'This provider session. Other BB threads separate.',
    coverage: pi ? 'Partial coverage. Earlier calls and hidden retries may be missing.' : cli && usage.coverage === 'unknown' ? 'Copilot CLI did not report coverage.' : null,
  };
}
