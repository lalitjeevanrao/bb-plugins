// ponytail: no SDK footer slot yet; replace this scoped adapter when BB adds one.
// Only our portal container moves. Never move or modify BB's context control.
export function attachCreditTarget(anchor, change) {
  const root = anchor?.closest('[data-app-composer]');
  if (!root) { change(null); return () => {}; }
  let host = null;
  const sync = () => {
    const buttons = [...root.querySelectorAll('[data-follow-up-composer-footer] button[aria-label^="Context window"]')]
      .filter(button => button.closest('[data-app-composer]') === root);
    const button = buttons.length === 1 ? buttons[0] : null;
    if (!button) { host?.remove(); host = null; change(null); return; }
    if (!host) {
      host = anchor.ownerDocument.createElement('span');
      host.setAttribute('data-session-credit-info', '');
      host.setAttribute('data-bb-plugin-root', '');
      host.setAttribute('data-bb-plugin', 'session-credits');
      host.style.display = 'contents';
    }
    if (host.parentNode !== button.parentNode || host.nextSibling !== button)
      button.parentNode.insertBefore(host, button);
    change(host);
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
  sync();
  return () => { observer.disconnect(); host?.remove(); };
}
