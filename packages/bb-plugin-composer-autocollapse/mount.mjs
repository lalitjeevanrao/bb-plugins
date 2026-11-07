import { normalizeKnobs, shouldCollapseOnFocusOut, shouldCollapseWhenIdle } from './policy.mjs';

export const SETTINGS_PATH = '/api/v1/plugins/composer-autocollapse/rpc/getSettings';
const PORTAL_SELECTOR = '[data-promptbox-typeahead-menu], [data-radix-popper-content-wrapper], [role="menu"], [role="listbox"]';
const IDLE_SWEEP_MS = 5000;
const SETTINGS_POLL_MS = 30_000;

const isHidden = element => Boolean(element.closest('[hidden], [aria-hidden="true"]'));

/** The prompt box that owns a visible collapse control, or null when the composer is collapsed. */
export function expandedComposer(doc = globalThis.document) {
  const control = Array.from(doc.querySelectorAll('[aria-label="Collapse prompt box"]')).find(button => !isHidden(button));
  return control?.closest('[class*="group/promptbox"]') ?? null;
}

async function fetchKnobs(fetchImpl = globalThis.fetch) {
  if (!fetchImpl) return null;
  const response = await fetchImpl(SETTINGS_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' });
  if (!response.ok) throw new Error(`settings request failed: ${response.status}`);
  return response.json();
}

let activeDispose = null;

/**
 * Collapse the BB composer when focus leaves it or it sits idle, with the
 * user's saved thresholds. Returns a disposer that removes every listener and
 * timer; a second mount replaces the first.
 * @param {{signal?: AbortSignal, document?: Document, fetchSettings?: () => Promise<unknown>, initialSettings?: unknown}} [options]
 * @returns {() => void}
 */
export function mountComposerAutocollapse({ signal, document: doc = globalThis.document, fetchSettings = fetchKnobs, initialSettings = null } = {}) {
  activeDispose?.();

  let knobs = normalizeKnobs(initialSettings);
  let disposed = false;
  let lastInput = Date.now();
  const timers = new Set();

  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
    timers.add(id);
  };
  const collapse = root => root.querySelector('[aria-label="Collapse prompt box"]')?.click();
  const collapseIfIdle = (root, active) => {
    const editor = root.querySelector('[contenteditable="true"]');
    return shouldCollapseWhenIdle({
      knobs,
      idleMs: Date.now() - lastInput,
      draftEmpty: (editor?.textContent ?? '').trim() === '',
      hidden: doc.visibilityState === 'hidden',
      focusedInside: Boolean(active && root.contains(active)),
    });
  };

  const onFocusOut = () => {
    if (!expandedComposer(doc)) return;
    later(() => {
      const root = expandedComposer(doc);
      if (!root) return;
      const active = doc.activeElement;
      if (shouldCollapseOnFocusOut({
        knobs,
        focusInsideComposer: Boolean(active && root.contains(active)),
        focusInPortal: Boolean(active && typeof active.closest === 'function' && active.closest(PORTAL_SELECTOR)),
      })) collapse(root);
    }, knobs.focusOutDelayMs);
  };
  const onActivity = () => { lastInput = Date.now(); };
  const sweep = () => {
    const root = expandedComposer(doc);
    if (root && collapseIfIdle(root, doc.activeElement)) collapse(root);
  };
  const applySettings = value => { if (value) knobs = normalizeKnobs(value); };

  const settingsTimer = setInterval(() => { fetchSettings().then(applySettings, () => {}); }, SETTINGS_POLL_MS);
  const idleTimer = setInterval(sweep, IDLE_SWEEP_MS);
  doc.addEventListener('focusout', onFocusOut, true);
  for (const event of ['input', 'keydown', 'pointerdown']) doc.addEventListener(event, onActivity, true);
  fetchSettings().then(applySettings, () => {});

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener('focusout', onFocusOut, true);
    for (const event of ['input', 'keydown', 'pointerdown']) doc.removeEventListener(event, onActivity, true);
    clearInterval(settingsTimer);
    clearInterval(idleTimer);
    for (const id of timers) clearTimeout(id);
    timers.clear();
    if (activeDispose === dispose) activeDispose = null;
  };
  activeDispose = dispose;

  if (signal) {
    if (signal.aborted) dispose();
    else signal.addEventListener('abort', dispose, { once: true });
  }
  return dispose;
}
