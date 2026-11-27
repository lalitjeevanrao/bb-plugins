import { DEFAULT_GREETING_FONT, formatGreeting } from "./greeting.ts";

export const HERO_ID = "bb-hero";
const STYLE_ID = "bb-hero-style";
const COLUMN_ATTR = "data-bb-hero-column";
const EFFECT_ATTR = "data-bb-hero-effect";
// Only a real home composer target counts: the home tree exposes `root-compose-*`,
// so a generic `.mx-auto` on another page can never host the hero.
const HOME_SELECTOR = '[data-testid^="root-compose"]';
const COMPOSER_SELECTOR = '[class*="group/promptbox"]';
const COLUMN_ANCESTOR = '[class*="max-w-[760px]"]';
const TYPE_MS = 950;
const TYPE_DELAY_MS = 250;

const CSS = `
[${COLUMN_ATTR}]{min-height:100%;flex:1 1 0%;justify-content:safe center;padding-top:max(10vh,4rem);padding-bottom:4vh}
#${HERO_ID}{display:flex;align-items:center;justify-content:center;gap:.875rem;max-width:min(100%,52rem);margin:0 auto 1.75rem;padding:0 1rem;text-align:center;user-select:none}
#${HERO_ID} .bb-hero-icon{width:3.25rem;height:3.25rem;border-radius:.9rem;object-fit:cover;flex:none}
#${HERO_ID} .bb-hero-greeting{font-size:clamp(24px,6vw,37px);font-style:italic;line-height:1.15;opacity:.85;overflow-wrap:anywhere;min-width:0}

@media (prefers-reduced-motion: no-preference) {
  #${HERO_ID}[${EFFECT_ATTR}="typewriter"] {
    animation: bb-hero-in ${TYPE_DELAY_MS}ms ease-in-out backwards;
  }
  #${HERO_ID} .bb-hero-greeting {
    animation: var(--bb-hero-entrance, none) 800ms ease-in-out backwards;
  }
  #${HERO_ID} .bb-hero-typing {
    animation: bb-hero-fade 520ms ease-in-out ${TYPE_DELAY_MS}ms backwards;
  }
}

@keyframes bb-hero-in{from{opacity:0}to{opacity:1}}
@keyframes bb-hero-fade {
  from { opacity: 0; }
}
@keyframes bb-hero-rise {
  from { opacity: 0; transform: translateY(.14em); }
}
@keyframes bb-hero-slide {
  from { opacity: 0; transform: translateX(-.18em); }
}
@keyframes bb-hero-pop {
  from { opacity: 0; transform: scale(.975); }
  70% { transform: scale(1.008); }
}
@keyframes bb-hero-settle {
  from { opacity: 0; transform: scale(1.025); }
}
@keyframes bb-hero-focus {
  from { opacity: 0; filter: blur(.045em); }
}
@keyframes bb-hero-wipe {
  from { opacity: 0; clip-path: inset(-.35em 22% -.35em -.35em); }
  to { clip-path: inset(-.35em); }
}
@keyframes bb-hero-unfold {
  from { opacity: 0; clip-path: inset(18% -.35em); }
  to { clip-path: inset(-.35em); }
}
@keyframes bb-hero-flip {
  from { opacity: 0; transform: perspective(480px) rotateX(-12deg); }
  to { transform: perspective(480px) rotateX(0deg); }
}
@keyframes bb-hero-swing {
  from { opacity: 0; transform: rotate(-2deg); transform-origin: 25% 70%; }
  to { transform: rotate(0deg); transform-origin: 25% 70%; }
}
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
  // The outgoing Home composer may still be mounted during a settings transition.
  if (/^\/settings(?:\/|$)/.test(doc.location?.pathname ?? "")) return null;
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
 * @param {{ displayName?: string, iconDataUrl?: string | null, hours?: number, label?: string, fontFamily?: string, effect?: string | null, reducedMotion?: boolean }} [options]
 * @returns {() => void}
 */
export function applyHero(doc, {
  displayName = "",
  iconDataUrl = null,
  hours = new Date().getHours(),
  label,
  fontFamily = DEFAULT_GREETING_FONT,
  effect = "typewriter",
  reducedMotion = false,
} = {}) {
  const column = findColumn(doc);
  if (!column) return () => {};
  const registry = registryFor(doc);
  registry.owners += 1;
  registry.cleanup?.();
  registry.cleanup = render(doc, column, {
    displayName: String(displayName ?? ""),
    iconDataUrl,
    hours,
    label,
    fontFamily,
    effect: reducedMotion ? null : effect,
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

function render(doc, column, { displayName, iconDataUrl, hours, label, fontFamily, effect }) {
  const view = doc.defaultView;
  const frame = view?.requestAnimationFrame?.bind(view);
  const canType = effect === "typewriter" && Boolean(frame);
  const full = formatGreeting(hours, displayName, label);

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
  if (effect) hero.setAttribute(EFFECT_ATTR, effect);
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
  greeting.style.fontFamily = fontFamily;
  if (canType) {
    greeting.classList.add("bb-hero-typing");
  } else if (effect && effect !== "typewriter") {
    greeting.style.setProperty("--bb-hero-entrance", `bb-hero-${effect}`);
  }
  const text = doc.createTextNode(canType ? "" : full);
  greeting.append(text);
  hero.append(greeting);

  column.prepend(hero);
  column.setAttribute(COLUMN_ATTR, "");

  let queued = 0;
  let disposed = false;
  if (canType) {
    // The centered flex row grows as characters appear, pushing the icon outward.
    const characters = Array.from(full);
    const started = Date.now() + TYPE_DELAY_MS;
    let painted = 0;
    const tick = () => {
      if (disposed) return;
      const progress = Math.min(1, Math.max(0, (Date.now() - started) / TYPE_MS));
      const length = progress > 0 ? Math.max(1, Math.round(characters.length * progress)) : 0;
      if (length !== painted) {
        painted = length;
        text.data = characters.slice(0, length).join("");
      }
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
