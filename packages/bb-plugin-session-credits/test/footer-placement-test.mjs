// Native-DOM checks, no jsdom/dependency. Run: node footer-placement-test.mjs > /tmp/credits-placement.html
// Open that HTML in a browser; window.results and the page contain the check results.
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../footer-placement.mjs', import.meta.url), 'utf8');
console.log(`<!doctype html><meta charset="utf-8"><title>Session credits placement checks</title><body><main id="fixtures"></main><pre id="results"></pre><script type="module">
${source}
const results = [], check = (name, value) => results.push({name, status:value ? 'passed' : 'failed'});
const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const make = () => {
  const root = document.createElement('div'); root.setAttribute('data-app-composer','');
  root.innerHTML = '<i></i><div data-follow-up-composer-footer><div><button aria-label="Context window 16% used">16%</button></div></div>';
  document.getElementById('fixtures').append(root);
  return {root, anchor:root.querySelector('i'), footer:root.querySelector('[data-follow-up-composer-footer]')};
};
const one = make(), two = make(); let target, second;
const dispose = attachCreditTarget(one.anchor, node => target = node);
const button = () => one.footer.querySelector('button');
check('Own container immediately precedes context control; BB control unchanged', target?.nextSibling === button() && target.parentNode === button().parentNode && button().textContent === '16%');
check('Another composer is not touched', !two.root.querySelector('[data-session-credit-info]'));
const disposeTwo = attachCreditTarget(two.anchor, node => second = node);
check('Two composers retain separate scoped targets', target !== second && one.root.contains(target) && two.root.contains(second));
const replacement = button().cloneNode(true); button().replaceWith(replacement); await tick();
check('Replaced native control reattaches one target without moving native nodes', target?.nextSibling === replacement && one.root.querySelectorAll('[data-session-credit-info]').length === 1);
one.footer.remove(); await tick();
check('Missing context control removes own target and signals local fallback', target === null && !one.root.querySelector('[data-session-credit-info]') && two.root.contains(second));
one.root.append(one.footer); const duplicate = replacement.cloneNode(true); replacement.parentNode.append(duplicate); await tick();
check('Ambiguous native controls fail closed instead of guessing', target === null);
duplicate.remove(); const nested = make(); one.root.append(nested.root); await tick();
check('Nested composer context cannot steal the owning composer target', target?.nextSibling === replacement && !nested.root.querySelector('[data-session-credit-info]'));
dispose(); replacement.replaceWith(replacement.cloneNode(true)); await tick();
check('Cleanup removes target and disconnects observer', !one.root.querySelector('[data-session-credit-info]'));
disposeTwo(); let orphan = 'unset'; const off = attachCreditTarget(document.createElement('i'), node => orphan = node); off();
check('Detached or unsupported scope signals fallback without querying another composer', orphan === null && !document.querySelector('[data-session-credit-info]'));
window.results = results; document.getElementById('results').textContent = JSON.stringify(results,null,2); document.body.dataset.complete='true';
</script>`);
