import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_KNOBS, normalizeKnobs, shouldCollapseOnFocusOut, shouldCollapseWhenIdle } from '../policy.mjs';
import { expandedComposer, mountComposerAutocollapse, visibleIn } from '../mount.mjs';

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const knobs = overrides => normalizeKnobs({ ...DEFAULT_KNOBS, focusOutDelayMs: 0, ...overrides });
const settle = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
// jsdom fires focusout on the element that loses focus, including the editor.
const focusOut = (window, target = '#outside') => window.document.querySelector(target).focus();

const dom = ({ draft = '', portal = false, collapseButton = true } = {}) => {
  const page = new JSDOM(`<!doctype html><html><body>
    <div class="flex"><div class="relative"><div class="@container/page"><div class="mx-auto">
      <div class="group/promptbox">
        ${collapseButton ? '<button aria-label="Collapse prompt box">collapse</button>' : ''}
        <div contenteditable="true">${draft}</div>
        <button aria-label="Model">model</button>
      </div>
    </div></div></div></div>
    <input id="outside" />
    ${portal ? '<div data-radix-popper-content-wrapper><div role="listbox" tabindex="0">menu</div></div>' : ''}
  </body></html>`);
  return page.window;
};

// jsdom never lays out, so tests supply the layout half of rendered visibility.
const layout = () => true;
const mount = (window, settings, extra = {}) => mountComposerAutocollapse({
  document: window.document,
  fetchSettings: async () => settings,
  initialSettings: settings,
  hasLayout: layout,
  ...extra,
});

test('policy: defaults match the shipped knobs', () => {
  assert.deepEqual(normalizeKnobs(null), { focusOutCollapse: true, focusOutDelayMs: 120, idleCollapse: true, idleSeconds: 60, idleEmptyDraft: true, idleHiddenTab: true });
});

test('policy: knobs are clamped and unknown values fall back', () => {
  const next = normalizeKnobs({ focusOutDelayMs: -40, idleSeconds: 99999, idleEmptyDraft: 'yes', idleHiddenTab: false });
  assert.equal(next.focusOutDelayMs, 0);
  assert.equal(next.idleSeconds, 3600);
  assert.equal(next.idleEmptyDraft, true);
  assert.equal(next.idleHiddenTab, false);
});

test('policy: focus-out collapses only outside the composer and its portals', () => {
  assert.equal(shouldCollapseOnFocusOut({ knobs: knobs(), focusInsideComposer: false, focusInPortal: false }), true);
  assert.equal(shouldCollapseOnFocusOut({ knobs: knobs(), focusInsideComposer: true, focusInPortal: false }), false);
  assert.equal(shouldCollapseOnFocusOut({ knobs: knobs(), focusInsideComposer: false, focusInPortal: true }), false);
  assert.equal(shouldCollapseOnFocusOut({ knobs: knobs({ focusOutCollapse: false }), focusInsideComposer: false, focusInPortal: false }), false);
});

test('policy: idle collapse honours the empty-draft and hidden-tab conditions', () => {
  const base = { knobs: knobs({ idleSeconds: 60 }), focusedInside: true, idleMs: 60_000 };
  assert.equal(shouldCollapseWhenIdle({ ...base, draftEmpty: true, hidden: false }), true);
  assert.equal(shouldCollapseWhenIdle({ ...base, draftEmpty: false, hidden: false }), false, 'nonempty visible draft is preserved');
  assert.equal(shouldCollapseWhenIdle({ ...base, draftEmpty: false, hidden: true }), true);
  assert.equal(shouldCollapseWhenIdle({ ...base, draftEmpty: true, hidden: false, focusedInside: false }), false);
  assert.equal(shouldCollapseWhenIdle({ ...base, idleMs: 59_000, draftEmpty: true, hidden: false }), false);
  assert.equal(shouldCollapseWhenIdle({ ...base, draftEmpty: false, hidden: true, knobs: knobs({ idleHiddenTab: false }) }), false);
  assert.equal(shouldCollapseWhenIdle({ ...base, draftEmpty: true, hidden: false, knobs: knobs({ idleCollapse: false }) }), false);
});

test('expandedComposer finds the prompt box that owns the collapse control', () => {
  const window = dom();
  const isVisible = visibleIn(window.document, layout);
  const root = expandedComposer(window.document, isVisible);
  assert.equal(root?.className, 'group/promptbox');
  const collapsed = dom({ collapseButton: false }).document;
  assert.equal(expandedComposer(collapsed, visibleIn(collapsed, layout)), null);
});

test('visibleIn rejects CSS-hidden and display:none trees', () => {
  const window = new JSDOM(`<!doctype html><html><head><style>.desktop-only{display:none}</style></head><body>
    <div class="desktop-only"><button aria-label="Collapse prompt box">hidden</button></div>
    <div><button aria-label="Collapse prompt box" id="visible">visible</button></div>
  </body></html>`).window;
  const isVisible = visibleIn(window.document, layout);
  assert.equal(isVisible(window.document.querySelector('.desktop-only button')), false);
  assert.equal(isVisible(window.document.querySelector('#visible')), true);
});

test('mount: a CSS-hidden first composer is skipped and the visible one collapses', async () => {
  const window = new JSDOM(`<!doctype html><html><head><style>.desktop-only{display:none}</style></head><body>
    <div class="desktop-only"><div class="group/promptbox" id="hidden-tree">
      <button aria-label="Collapse prompt box" id="hidden-collapse">collapse</button>
    </div></div>
    <div><div class="group/promptbox" id="visible-tree">
      <button aria-label="Collapse prompt box" id="visible-collapse">collapse</button>
      <div contenteditable="true" id="visible-editor"></div>
    </div></div>
    <input id="outside" />
  </body></html>`).window;
  let hiddenClicks = 0;
  let visibleClicks = 0;
  window.document.querySelector('#hidden-collapse').addEventListener('click', () => { hiddenClicks += 1; });
  window.document.querySelector('#visible-collapse').addEventListener('click', () => { visibleClicks += 1; });
  window.document.querySelector('#visible-editor').focus();
  const dispose = mount(window, knobs());
  focusOut(window);
  await settle();
  assert.equal(hiddenClicks, 0, 'the hidden desktop tree stays alone');
  assert.equal(visibleClicks, 1, 'the visible composer receives the collapse');
  dispose();
});

test('mount: focus leaving the composer collapses once', async () => {
  const window = dom();
  let clicks = 0;
  window.document.querySelector('[aria-label="Collapse prompt box"]').addEventListener('click', () => { clicks += 1; });
  window.document.querySelector('[contenteditable="true"]').focus();
  const dispose = mount(window, knobs());
  focusOut(window);
  await settle();
  assert.equal(clicks, 1);
  dispose();
});

test('mount: focus moving inside the composer or its portal does not collapse', async () => {
  const window = dom({ portal: true });
  let clicks = 0;
  window.document.querySelector('[aria-label="Collapse prompt box"]').addEventListener('click', () => { clicks += 1; });
  window.document.querySelector('[contenteditable="true"]').focus();
  const dispose = mount(window, knobs());
  focusOut(window, '[aria-label="Model"]');
  await settle();
  focusOut(window, '[role="listbox"]');
  await settle();
  assert.equal(clicks, 0);
  dispose();
});

test('mount: a disabled focus-out knob leaves the editor open', async () => {
  const window = dom();
  let clicks = 0;
  window.document.querySelector('[aria-label="Collapse prompt box"]').addEventListener('click', () => { clicks += 1; });
  window.document.querySelector('[contenteditable="true"]').focus();
  const dispose = mount(window, knobs({ focusOutCollapse: false }));
  focusOut(window);
  await settle();
  assert.equal(clicks, 0);
  dispose();
});

test('mount: native draft text survives the collapse', async () => {
  const window = dom({ draft: 'keep this draft' });
  let clicks = 0;
  window.document.querySelector('[aria-label="Collapse prompt box"]').addEventListener('click', () => { clicks += 1; });
  window.document.querySelector('[contenteditable="true"]').focus();
  const dispose = mount(window, knobs());
  focusOut(window);
  await settle();
  assert.equal(clicks, 1);
  assert.equal(window.document.querySelector('[contenteditable="true"]').textContent, 'keep this draft');
  dispose();
});

test('mount: a missing composer is harmless', async () => {
  const window = new JSDOM('<!doctype html><body><input id="outside"></body>').window;
  const dispose = mount(window, knobs());
  window.document.querySelector('#outside').focus();
  const detached = mount(new JSDOM('<!doctype html><body></body>').window, knobs());
  await settle();
  dispose();
  detached();
});

test('mount: disposal removes listeners and pending work', async () => {
  const window = dom();
  let clicks = 0;
  window.document.querySelector('[aria-label="Collapse prompt box"]').addEventListener('click', () => { clicks += 1; });
  window.document.querySelector('[contenteditable="true"]').focus();
  const dispose = mount(window, { ...knobs(), focusOutDelayMs: 20 });
  focusOut(window);
  dispose();
  await settle(40);
  assert.equal(clicks, 0, 'a disposed mount must not collapse on a queued focus-out');
});

test('mount: mounting twice keeps a single active instance', async () => {
  const window = dom();
  let clicks = 0;
  window.document.querySelector('[aria-label="Collapse prompt box"]').addEventListener('click', () => { clicks += 1; });
  window.document.querySelector('[contenteditable="true"]').focus();
  const first = mount(window, knobs());
  const second = mount(window, knobs());
  focusOut(window);
  await settle();
  assert.equal(clicks, 1);
  first();
  second();
});

const results = [];
for (const [name, fn] of cases) {
  try { await fn(); results.push(`ok   ${name}`); } catch (error) { results.push(`FAIL ${name}\n${error.stack}`); }
}
const failures = results.filter(row => row.startsWith('FAIL'));
console.log(results.join('\n'));
if (failures.length) { console.error(`\n${failures.length} failing`); process.exit(1); }
console.log(`\n${results.length} passing`);
