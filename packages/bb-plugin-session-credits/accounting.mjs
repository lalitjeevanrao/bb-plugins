// Exact integer accounting. No token prices or monetary estimates.
export const digits = value => typeof value === 'string' && /^\d{1,40}$/.test(value) ? BigInt(value).toString() : Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
export function nanoToAic(value) {
  const d = digits(value); if (d === null) return null;
  const n = BigInt(d), f = (n % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
  return String(n / 1000000000n) + (f ? '.' + f : '');
}
export function displayAic(value) {
  if (value === null) return '—';
  if (!/^\d+(\.\d{1,9})?$/.test(value)) return '—';
  const [whole, fraction = ''] = value.split('.');
  const nano = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  if (nano > 0n && nano < 100000n) return '<0.0001';
  const rounded = (nano + 50000n) / 100000n;
  return String(rounded / 10000n) + '.' + String(rounded % 10000n).padStart(4, '0');
}
// Recording state is not a claim that full billing history or an invoice is complete.
export function meterState(usage) {
  if (!usage) return 'Loading';
  if (usage.captureIssue || usage.missing > 0 || usage.conflicting > 0 || (usage.source === 'copilot-checkpoint' && usage.coverage === 'partial')) return 'Missing data';
  if (usage.inFlight > 0) return 'Updating';
  if (usage.aic === null) return 'Unavailable';
  return usage.coverage === 'unknown' ? 'Coverage unknown' : 'Recorded';
}
const base = source => ({ aic: null, source, captureIssue: false, coverage: 'unavailable', reported: 0, observed: 0, inFlight: 0, conflicting: 0, missing: 0, updatedAt: null, reason: 'No billing data recorded' });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Input has already passed host file/identity/sequence validation.
export function piUsage(records) {
  const result = base('pi-receipts'), calls = new Map();
  for (const row of records) {
    if (typeof row.at === 'string' && Number.isFinite(Date.parse(row.at)) && (!result.updatedAt || row.at > result.updatedAt)) result.updatedAt = row.at;
    if (!uuid.test(row.callId ?? '')) continue;
    if (row.kind === 'call_started') {
      // Repeated starts are ambiguous, never silently merge independent invocations.
      if (calls.has(row.callId)) calls.get(row.callId).bad = true;
      else calls.set(row.callId, { amounts: new Set(), done: false, bad: false });
    }
    const call = calls.get(row.callId); if (!call) continue;
    if (row.kind === 'call_finished') { if (call.done) call.bad = true; call.done = true; }
    if (row.kind === 'observation') for (const value of row.billing ?? []) {
      const n = digits(value.nanoAiu);
      if (value.invalid || value.missingAmount || n === null) call.bad = true;
      else call.amounts.add(n);
    }
  }
  let sum = 0n;
  for (const call of calls.values()) {
    result.observed++;
    if (!call.done) result.inFlight++;
    else if (call.bad || call.amounts.size > 1) result.conflicting++;
    else if (!call.amounts.size) result.missing++;
    else { sum += BigInt([...call.amounts][0]); result.reported++; }
  }
  if (result.reported) result.aic = nanoToAic(sum.toString());
  result.coverage = result.observed ? 'partial' : 'unavailable';
  result.reason = result.observed ? 'Observed completed calls only; excludes missing history, uncertain retries and conflicting or unfinished calls. Not invoice-reconciled.' : 'No captured Copilot calls for this provider session. A Pi process started before collector installation needs an idle reload; historical credits cannot be reconstructed.';
  return result;
}
export function cliUsage(checkpoint) {
  const result = base('copilot-checkpoint');
  if (!checkpoint) return result;
  const data = checkpoint.data ?? {}, coverage = data.accountingSnapshot?.aiCreditsStatus;
  result.updatedAt = typeof checkpoint.timestamp === 'string' && Number.isFinite(Date.parse(checkpoint.timestamp)) ? checkpoint.timestamp : null;
  result.coverage = ['complete', 'partial', 'unavailable'].includes(coverage) ? coverage : 'unknown';
  result.aic = coverage === 'unavailable' ? null : nanoToAic(data.totalNanoAiu);
  // A legacy zero without coverage metadata does not prove a free session.
  if (result.coverage === 'unknown' && result.aic === '0') result.aic = null;
  if (result.aic === null && result.coverage === 'complete') result.coverage = 'unknown';
  result.reason = 'Latest CLI cumulative checkpoint, including internal subagents. Coverage is provider-reported; not an account quota or invoice.';
  return result;
}
