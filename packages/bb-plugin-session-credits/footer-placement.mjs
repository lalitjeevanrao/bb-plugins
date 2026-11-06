// ponytail: no SDK footer slot yet; replace this scoped adapter when BB adds one.
// Only our portal container moves. Never move or modify BB's context control.
export function attachCreditTarget(anchor, change) {
  const root = anchor?.closest('[data-app-composer]');
  if (!root) { change(null); return () => {}; }
  let host = null;
  const sync = () => {
    const footers = [...root.querySelectorAll('[data-follow-up-composer-footer]')]
      .filter(footer => footer.closest('[data-app-composer]') === root);
    const footer = footers.length === 1 ? footers[0] : null;
    const group = footer?.lastElementChild;
    const buttons = footer ? [...footer.querySelectorAll('button[aria-label^="Context window"]')]
      .filter(button => button.closest('[data-app-composer]') === root) : [];
    const validGroup = footer?.children.length === 2 && [...footer.children].every(child => child.tagName === 'DIV')
      && group.classList.contains('shrink-0') && group.classList.contains('items-center');
    const button = buttons[0] ?? null;
    if (!validGroup || buttons.length > 1 || (button && button.parentNode !== group)) {
      host?.remove(); host = null; change(null); return;
    }
    if (!host) {
      host = anchor.ownerDocument.createElement('span');
      host.setAttribute('data-session-credit-info', '');
      host.setAttribute('data-bb-plugin-root', '');
      host.setAttribute('data-bb-plugin', 'session-credits');
      host.style.display = 'contents';
    }
    if (host.parentNode !== group || host.nextSibling !== button)
      group.insertBefore(host, button);
    change(host);
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
  sync();
  return () => { observer.disconnect(); host?.remove(); };
}
