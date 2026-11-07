export const HERO_ID = "bb-hero";
const STYLE_ID = "bb-hero-style";
const COLUMN_ATTR = "data-bb-hero-column";
// Only a real home composer target counts: the home tree exposes `root-compose-*`,
// so a generic `.mx-auto` on another page can never host the hero.
const HOME_SELECTOR = '[data-testid^="root-compose"]';
const COMPOSER_SELECTOR = '[class*="group/promptbox"]';
const COLUMN_ANCESTOR = '[class*="max-w-[760px]"]';
const TYPE_MS = 850;
const TYPE_DELAY_MS = 200;

const CSS = `
[${COLUMN_ATTR}]{min-height:100%;flex:1 1 0%;justify-content:safe center;padding-top:max(10vh,4rem);padding-bottom:4vh}
#${HERO_ID}{display:flex;align-items:center;justify-content:center;gap:.875rem;max-width:min(100%,52rem);margin:0 auto 1.75rem;padding:0 1rem;text-align:center;user-select:none;animation:bb-hero-in 200ms ease-out both}
#${HERO_ID} .bb-hero-icon{width:3.25rem;height:3.25rem;border-radius:.9rem;object-fit:cover;flex:none}
#${HERO_ID} .bb-hero-greeting{font-size:clamp(24px,6vw,37px);line-height:1.15;opacity:.85;overflow-wrap:anywhere;min-width:0}
#${HERO_ID} .bb-hero-hello{font-family:Palatino,'Palatino Linotype',serif;font-style:italic}
#${HERO_ID} .bb-hero-name{font-family:Georgia,serif;font-weight:400;font-variant:small-caps}
@keyframes bb-hero-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){#${HERO_ID}{animation:none}}
`;

/** A desktop/compact duplicate tree can be CSS-hidden; never target it. */
export function isHiddenElement(node) {
  const view = node?.ownerDocument?.defaultView;
  for (let current = node; current; current = current.parentElement) {
    if (current.hasAttribute?.("hidden") || current.getAttribute?.("aria-hidden") === "true") return true;
    const style = view?.getComputedStyle?.(current);
    if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  }
  return false;
}

export function findColumn(doc = globalThis.document) {
  for (const composer of doc.querySelectorAll(COMPOSER_SELECTOR)) {
    // The home anchor keeps an unrelated page's composer or `.mx-auto` out.
    if (!composer.closest(HOME_SELECTOR) || isHiddenElement(composer)) continue;
    const column = composer.closest(COLUMN_ANCESTOR) ?? composer.closest(".mx-auto") ?? composer.parentElement;
    if (column) return column;
  }
  return null;
}

/** One registry per document: owners counts live mounts so the hero outlives all but the last. */
const registries = new WeakMap();
function registryFor(doc) {
  let registry = registries.get(doc);
  if (!registry) {
    registry = { owners: 0, cleanup: null };
    registries.set(doc, registry);
  }
  return registry;
}

/**
 * Render the greeting hero at the top of the home composer column. Returns a
 * disposer tied to one owner: re-rendering replaces the previous hero, and the
 * DOM is only removed once the last mounted owner has disposed.
 * @param {Document} doc
 * @param {{ displayName?: string, iconDataUrl?: string | null, hours?: number, reducedMotion?: boolean }} [options]
 * @returns {() => void}
 */
export function applyHero(doc, { displayName = "", iconDataUrl = null, hours, reducedMotion = false } = {}) {
  const column = findColumn(doc);
  if (!column) return () => {};
  const registry = registryFor(doc);
  registry.owners += 1;
  registry.cleanup?.();
  registry.cleanup = render(doc, column, {
    displayName: String(displayName ?? "").trim(),
    iconDataUrl,
    hours,
    reducedMotion,
  });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    registry.owners = Math.max(0, registry.owners - 1);
    if (registry.owners > 0) return;
    registry.cleanup?.();
    registry.cleanup = null;
    registries.delete(doc);
  };
}

function render(doc, column, { displayName, iconDataUrl, hours, reducedMotion }) {
  const view = doc.defaultView;
  const hour = Number.isFinite(hours) ? hours : new Date().getHours();
  const full = greetingText(hour, displayName);
  const helloText = full.slice(0, full.length - displayName.length);

  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.append(style);
  }

  const hero = doc.createElement("div");
  hero.id = HERO_ID;
  hero.setAttribute("role", "presentation");
  if (iconDataUrl) {
    const icon = doc.createElement("img");
    icon.className = "bb-hero-icon";
    icon.alt = "";
    icon.decoding = "async";
    icon.src = iconDataUrl;
    hero.append(icon);
  }
  const greeting = doc.createElement("div");
  greeting.className = "bb-hero-greeting";
  // In-flow text: the centered flex row grows symmetrically as characters appear,
  // so the greeting expands from its center and pushes the icon outward.
  const hello = doc.createElement("span");
  hello.className = "bb-hero-hello";
  const name = doc.createElement("span");
  name.className = "bb-hero-name";
  greeting.append(hello, name);
  hero.append(greeting);

  let painted = -1;
  const paint = length => {
    if (length === painted) return;
    painted = length;
    if (length <= helloText.length) {
      hello.textContent = full.slice(0, length);
      name.textContent = "";
      return;
    }
    hello.textContent = helloText;
    name.textContent = full.slice(helloText.length, length);
  };
  const frame = view?.requestAnimationFrame?.bind(view);
  const canAnimate = !reducedMotion && Boolean(frame) && full.length > 0;
  paint(canAnimate ? 0 : full.length);

  column.prepend(hero);
  column.setAttribute(COLUMN_ATTR, "");

  let queued = 0;
  let disposed = false;
  if (canAnimate) {
    const started = Date.now() + TYPE_DELAY_MS;
    const tick = () => {
      if (disposed) return;
      const progress = Math.min(1, Math.max(0, (Date.now() - started) / TYPE_MS));
      paint(progress > 0 ? Math.max(1, Math.round(full.length * progress)) : 0);
      if (progress < 1) queued = frame(tick);
    };
    queued = frame(tick);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (queued) view?.cancelAnimationFrame?.(queued);
    hero.remove();
    column.removeAttribute(COLUMN_ATTR);
    if (!doc.querySelector(`[${COLUMN_ATTR}]`)) doc.getElementById(STYLE_ID)?.remove();
  };
}

function greetingText(hours, name) {
  return name ? `${greetingLabel(hours)}, ${name}` : greetingLabel(hours);
}

function greetingLabel(hours) {
  if (hours < 12) return "Morning";
  if (hours < 17) return "Afternoon";
  return "Evening";
}
